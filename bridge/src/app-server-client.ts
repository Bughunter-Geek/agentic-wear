import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import WebSocket from "ws";
import { z } from "zod";
import {
  jsonRpcMessageSchema,
  threadListResponseSchema,
  threadSchema,
  turnCompletedSchema,
  turnListResponseSchema,
  turnStartedSchema,
  type CodexThread,
} from "./schemas.js";

export type SessionView = {
  id: string;
  title: string;
  updatedAt: number;
  status: "active" | "idle" | "error" | "notLoaded";
  ownedByWear: boolean;
  canAcceptDirectInput: boolean;
};

export type TerminalEvent = {
  eventId: string;
  kind: "terminal.completed" | "terminal.failed" | "terminal.interrupted";
  turnScope: "topLevel";
  threadId: string;
  title: string;
  detail: string;
  occurredAt: number;
};

export type ApprovalEvent = {
  eventId: string;
  kind: "approval.request";
  threadId: string;
  title: string;
  detail: string;
  occurredAt: number;
  approvalId: string;
  canControl: boolean;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type PendingApproval = {
  rpcId: string | number;
  method: "command" | "file";
  threadId: string;
};

const responseWithThreadSchema = z.object({ thread: threadSchema }).passthrough();
const threadStartedSchema = z.object({ thread: threadSchema }).passthrough();
const approvalParamsSchema = z.object({
  threadId: z.string().min(1).max(128),
  turnId: z.string().min(1).max(128),
  itemId: z.string().min(1).max(128),
  approvalId: z.string().min(1).max(128).nullable().optional(),
  startedAtMs: z.number().int().positive(),
  reason: z.string().nullable().optional(),
  command: z.string().nullable().optional(),
  cwd: z.string().nullable().optional(),
  availableDecisions: z.array(z.string()).optional(),
}).passthrough();

export class AppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private socket: WebSocket | null = null;
  private lines: Interface | null = null;
  private requestNumber = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly threadCache = new Map<string, CodexThread>();
  private readonly activeTurns = new Map<string, string>();
  private readonly subscriptions = new Set<string>();
  private readonly subscribing = new Set<string>();
  private readonly deliveredTerminalEvents = new Set<string>();
  private stopping = false;

  constructor(
    private readonly watchOwnedThreadIds: Set<string>,
    private readonly onTerminal: (event: TerminalEvent) => Promise<void>,
    private readonly onApproval: (event: ApprovalEvent) => Promise<void>,
    private readonly onFatal: (error: Error) => void = () => {},
  ) {}

  async connect(transport: "daemon" | "stdio" = "daemon"): Promise<void> {
    if (this.child || this.socket) return;
    if (transport === "daemon") await this.openDaemonSocket();
    else this.openStdio();
    await this.initialize();
    const sessions = await this.listSessions();
    for (const session of sessions) {
      if (session.status !== "notLoaded") await this.subscribeLoadedThread(session.id);
    }
  }

  private openStdio(): void {
    const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const message = chunk.trim().slice(0, 500);
      if (message) {
        const record: Record<string, string> = { level: "error", message: "Codex App Server reported an error" };
        if (process.env.AGENTIC_WEAR_DEBUG === "1") record.detail = message;
        console.error(JSON.stringify(record));
      }
    });
    child.once("error", (error) => this.handleFatal(error));
    child.once("exit", (code) => this.handleFatal(new Error(`Codex App Server exited (${code ?? "unknown"})`)));
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => {
      void this.handleLine(line).catch((error: unknown) => {
        console.error(JSON.stringify({ level: "error", message: "invalid app-server message", error: safeError(error) }));
      });
    });
  }

  private async openDaemonSocket(): Promise<void> {
    const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
    const socketPath = process.env.AGENTIC_WEAR_CODEX_SOCKET ?? join(
      codexHome,
      "app-server-control",
      "app-server-control.sock",
    );
    const socket = new WebSocket(`ws+unix://${socketPath}:/`, {
      handshakeTimeout: 10_000,
      maxPayload: 2 * 1_024 * 1_024,
      perMessageDeflate: false,
    });
    this.socket = socket;
    socket.on("message", (data, binary) => {
      if (binary) {
        socket.close(1003, "Text messages required");
        return;
      }
      void this.handleLine(data.toString("utf8")).catch((error: unknown) => {
        console.error(JSON.stringify({ level: "error", message: "invalid app-server message", error: safeError(error) }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      let opened = false;
      const openingError = (error: Error) => {
        if (!opened) reject(error);
        else this.handleFatal(error);
      };
      socket.on("error", openingError);
      socket.once("open", () => {
        opened = true;
        resolve();
      });
      socket.once("close", (code) => {
        const error = new Error(`Codex App Server socket closed (${code})`);
        if (!opened) reject(error);
        else if (!this.stopping) this.handleFatal(error);
      });
    });
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "agentic_wear", title: "Agentic Wear", version: "0.1.0" },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
        optOutNotificationMethods: [
          "item/agentMessage/delta",
          "item/reasoning/summaryTextDelta",
          "item/reasoning/summaryPartAdded",
          "item/reasoning/textDelta",
          "item/commandExecution/outputDelta",
          "item/fileChange/outputDelta",
          "item/fileChange/patchUpdated",
          "item/mcpToolCall/progress",
          "turn/diff/updated",
          "turn/plan/updated",
          "thread/tokenUsage/updated",
          "rawResponseItem/completed",
          "rawResponse/completed",
          "fs/changed",
        ],
      },
    });
    this.notify("initialized", {});
  }

  async listSessions(): Promise<SessionView[]> {
    const raw = await this.request("thread/list", {
      limit: 50,
      sortKey: "recency_at",
      sortDirection: "desc",
      sourceKinds: ["cli", "vscode", "exec", "appServer"],
      archived: false,
      useStateDbOnly: false,
    });
    const response = threadListResponseSchema.parse(raw);
    for (const thread of response.data) this.threadCache.set(thread.id, thread);
    return response.data.filter(isTopLevelUserThread).map((thread) => this.sessionView(thread));
  }

  async submitTurn(threadId: string | null, text: string, defaultCwd: string): Promise<{ threadId: string; created: boolean }> {
    let thread: CodexThread;
    let created = false;
    if (threadId === null) {
      const raw = await this.request("thread/start", {
        cwd: defaultCwd,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        serviceName: "Agentic Wear",
        ephemeral: false,
      });
      thread = responseWithThreadSchema.parse(raw).thread;
      this.threadCache.set(thread.id, thread);
      this.watchOwnedThreadIds.add(thread.id);
      this.subscriptions.add(thread.id);
      created = true;
    } else {
      thread = await this.readThread(threadId);
      if (thread.status.type === "active") {
        const activeTurnId = this.activeTurns.get(thread.id);
        if (!this.watchOwnedThreadIds.has(thread.id) || !activeTurnId) {
          throw new Error("That desktop-owned session is active. Wait until it is idle before replying from the watch.");
        }
        await this.request("turn/steer", {
          threadId: thread.id,
          expectedTurnId: activeTurnId,
          input: [textInput(text)],
          responsesapiClientMetadata: { source: "agentic-wear" },
        });
        return { threadId: thread.id, created: false };
      }
      if (thread.status.type === "notLoaded" || thread.status.type === "systemError") {
        const raw = await this.request("thread/resume", { threadId: thread.id, excludeTurns: true });
        thread = responseWithThreadSchema.parse(raw).thread;
        this.threadCache.set(thread.id, thread);
      }
    }
    await this.request("turn/start", {
      threadId: thread.id,
      input: [textInput(text)],
      responsesapiClientMetadata: { source: "agentic-wear" },
    });
    return { threadId: thread.id, created };
  }

  async monitorTerminals(signal: AbortSignal, intervalMs = 20_000): Promise<void> {
    let previous = snapshot(await this.listSessions());
    while (!signal.aborted) {
      await delay(intervalMs, signal);
      if (signal.aborted) return;
      try {
        const sessions = await this.listSessions();
        for (const session of sessions) {
          const before = previous.get(session.id);
          const mayHaveFinished = session.status !== "active" && (
            before === undefined || before.status === "active" || session.updatedAt > before.updatedAt
          );
          if (mayHaveFinished) await this.emitLatestTerminal(session);
        }
        previous = snapshot(sessions);
      } catch (error) {
        console.error(JSON.stringify({ level: "error", message: "terminal monitor retrying", error: safeError(error) }));
      }
    }
  }

  respondToApproval(approvalId: string, decision: "accept" | "decline"): void {
    const pending = this.approvals.get(approvalId);
    if (!pending) throw new Error("That approval is no longer active");
    if (!this.watchOwnedThreadIds.has(pending.threadId)) throw new Error("Desktop-owned approvals are alert-only");
    this.write({ id: pending.rpcId, result: { decision } });
    this.approvals.delete(approvalId);
  }

  close(): void {
    this.stopping = true;
    this.lines?.close();
    this.lines = null;
    this.child?.kill("SIGTERM");
    this.child = null;
    this.socket?.close(1000, "Bridge stopping");
    this.socket = null;
    this.failAll(new Error("Codex App Server closed"));
  }

  private async handleLine(line: string): Promise<void> {
    if (line.length > 2 * 1_024 * 1_024) throw new Error("App Server message exceeded 2 MiB");
    const message = jsonRpcMessageSchema.parse(JSON.parse(line));
    if (message.id !== undefined && !message.method) {
      const key = String(message.id);
      const pending = this.pending.get(key);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(key);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      await this.handleServerRequest(message.id, message.method, message.params);
      return;
    }
    if (message.method) await this.handleNotification(message.method, message.params);
  }

  private async handleNotification(method: string, params: unknown): Promise<void> {
    if (method === "thread/started") {
      const event = threadStartedSchema.parse(params);
      this.threadCache.set(event.thread.id, event.thread);
      if (!this.subscriptions.has(event.thread.id)) await this.subscribeLoadedThread(event.thread.id);
      return;
    }
    if (method === "turn/started") {
      const event = turnStartedSchema.parse(params);
      if (event.threadId) this.activeTurns.set(event.threadId, event.turn.id);
      return;
    }
    const terminal = parseTerminalNotification(method, params);
    if (terminal) {
      const event = terminal;
      this.activeTurns.delete(event.threadId);
      const thread = await this.readThread(event.threadId, true);
      if (!isTopLevelUserThread(thread)) return;
      const occurredAt = event.turn.completedAt ? event.turn.completedAt * 1_000 : Date.now();
      const kind = `terminal.${event.turn.status}` as TerminalEvent["kind"];
      const detail = event.turn.status === "completed"
        ? "The agent finished its full response."
        : event.turn.status === "failed"
          ? clean(event.turn.error?.message ?? "The agent stopped with an error.", 260)
          : "The agent was interrupted before finishing.";
      await this.emitTerminal({
        eventId: `turn:${event.threadId}:${event.turn.id}:${event.turn.status}`,
        kind,
        turnScope: "topLevel",
        threadId: event.threadId,
        title: threadTitle(thread),
        detail,
        occurredAt,
      });
      return;
    }
    if (method === "thread/name/updated" || method === "thread/status/changed") {
      const update = z.object({
        threadId: z.string(),
        status: z.object({ type: z.enum(["notLoaded", "idle", "systemError", "active"]) }).optional(),
      }).passthrough().safeParse(params);
      if (update.success) {
        if (update.data.status && update.data.status.type !== "notLoaded") {
          await this.subscribeLoadedThread(update.data.threadId);
        }
        await this.readThread(update.data.threadId, true);
      }
      return;
    }
    if (method === "serverRequest/resolved") {
      const resolved = z.object({ requestId: z.union([z.string(), z.number()]) }).passthrough().safeParse(params);
      if (resolved.success) {
        for (const [approvalId, approval] of this.approvals) {
          if (String(approval.rpcId) === String(resolved.data.requestId)) this.approvals.delete(approvalId);
        }
      }
    }
  }

  private async handleServerRequest(id: string | number, method: string, params: unknown): Promise<void> {
    const supported = method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval";
    const parsed = approvalParamsSchema.safeParse(params);
    if (!parsed.success) return;
    const thread = await this.readThread(parsed.data.threadId);
    const approvalId = parsed.data.approvalId ?? parsed.data.itemId;
    const canControl = supported && this.watchOwnedThreadIds.has(parsed.data.threadId) &&
      (!parsed.data.availableDecisions || ["accept", "decline"].every((value) => parsed.data.availableDecisions?.includes(value)));
    if (canControl) {
      this.approvals.set(approvalId, {
        rpcId: id,
        method: method.includes("fileChange") ? "file" : "command",
        threadId: parsed.data.threadId,
      });
      if (this.approvals.size > 100) this.approvals.delete(this.approvals.keys().next().value ?? "");
    }
    const detail = clean(
      parsed.data.reason ?? parsed.data.command ??
        (method.includes("fileChange") ? "Allow the proposed file changes?" : "The agent needs your permission."),
      260,
    );
    await this.onApproval({
      eventId: `approval:${parsed.data.threadId}:${parsed.data.turnId}:${approvalId}`,
      kind: "approval.request",
      threadId: parsed.data.threadId,
      title: threadTitle(thread),
      detail,
      occurredAt: parsed.data.startedAtMs,
      approvalId,
      canControl,
    });
  }

  private async readThread(threadId: string, force = false): Promise<CodexThread> {
    if (!force) {
      const cached = this.threadCache.get(threadId);
      if (cached) return cached;
    }
    const raw = await this.request("thread/read", { threadId, includeTurns: false });
    const thread = responseWithThreadSchema.parse(raw).thread;
    this.threadCache.set(thread.id, thread);
    return thread;
  }

  private async subscribeLoadedThread(threadId: string): Promise<void> {
    if (this.subscriptions.has(threadId) || this.subscribing.has(threadId)) return;
    this.subscribing.add(threadId);
    try {
      const raw = await this.request("thread/resume", { threadId, excludeTurns: true });
      const thread = responseWithThreadSchema.parse(raw).thread;
      this.threadCache.set(thread.id, thread);
      this.subscriptions.add(thread.id);
    } finally {
      this.subscribing.delete(threadId);
    }
  }

  private async emitLatestTerminal(session: SessionView): Promise<void> {
    const raw = await this.request("thread/turns/list", {
      threadId: session.id,
      limit: 1,
      sortDirection: "desc",
      itemsView: "notLoaded",
    });
    const turn = turnListResponseSchema.parse(raw).data[0];
    if (!turn || turn.status === "inProgress") return;
    const kind = `terminal.${turn.status}` as TerminalEvent["kind"];
    const detail = turn.status === "completed"
      ? "The agent finished its full response."
      : turn.status === "failed"
        ? clean(turn.error?.message ?? "The agent stopped with an error.", 260)
        : "The agent was interrupted before finishing.";
    await this.emitTerminal({
      eventId: `turn:${session.id}:${turn.id}:${turn.status}`,
      kind,
      turnScope: "topLevel",
      threadId: session.id,
      title: session.title,
      detail,
      occurredAt: turn.completedAt ? turn.completedAt * 1_000 : Date.now(),
    });
  }

  private async emitTerminal(event: TerminalEvent): Promise<void> {
    if (this.deliveredTerminalEvents.has(event.eventId)) return;
    this.deliveredTerminalEvents.add(event.eventId);
    if (this.deliveredTerminalEvents.size > 2_000) {
      const oldest = this.deliveredTerminalEvents.values().next().value;
      if (oldest) this.deliveredTerminalEvents.delete(oldest);
    }
    try {
      await this.onTerminal(event);
    } catch (error) {
      this.deliveredTerminalEvents.delete(event.eventId);
      throw error;
    }
  }

  private sessionView(thread: CodexThread): SessionView {
    return {
      id: thread.id,
      title: threadTitle(thread),
      updatedAt: thread.updatedAt * 1_000,
      status: thread.status.type === "systemError" ? "error" : thread.status.type,
      ownedByWear: this.watchOwnedThreadIds.has(thread.id),
      canAcceptDirectInput: thread.canAcceptDirectInput === true,
    };
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.requestNumber;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`${method} timed out`));
      }, 30_000);
      timeout.unref();
      this.pending.set(String(id), { resolve, reject, timeout });
      try {
        this.write({ method, id, params });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(String(id));
        reject(error instanceof Error ? error : new Error("Could not write to App Server"));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  private write(message: Record<string, unknown>): void {
    const encoded = JSON.stringify(message);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(encoded);
      return;
    }
    if (this.child?.stdin.writable) {
      this.child.stdin.write(`${encoded}\n`);
      return;
    }
    throw new Error("Codex App Server is not connected");
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private handleFatal(error: Error): void {
    this.failAll(error);
    if (!this.stopping) this.onFatal(error);
  }
}

export function parseTerminalNotification(method: string, params: unknown): z.infer<typeof turnCompletedSchema> | null {
  if (method !== "turn/completed") return null;
  return turnCompletedSchema.parse(params);
}

export function isTopLevelUserThread(thread: CodexThread): boolean {
  return thread.parentThreadId == null && thread.agentRole == null;
}

function textInput(text: string): Record<string, unknown> {
  return { type: "text", text, text_elements: [] };
}

function threadTitle(thread: CodexThread): string {
  return clean(thread.name ?? thread.preview, 100) || "Untitled session";
}

function clean(value: string, limit: number): string {
  return value.trim().replace(/\s+/gu, " ").slice(0, limit);
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown error").slice(0, 400);
}

function snapshot(sessions: SessionView[]): Map<string, Pick<SessionView, "status" | "updatedAt">> {
  return new Map(sessions.map((session) => [session.id, { status: session.status, updatedAt: session.updatedAt }]));
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      finish();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
