import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { nativeVoiceCommandSchema, nativeVoiceEventSchema, type NativeVoiceCommand, type NativeVoiceEvent } from "./native-dot-protocol.js";
import {
  CLOUD_FRAME_BYTES, CLOUD_MAX_AGE_MS, cloudAckSchema, cloudEventId, cloudSendSchema, cloudSendResultSchema,
  type CloudSend, type CloudSendResult,
  desktopCloudConfigPath, desktopCloudSocketPath, logDesktopCloud, readDesktopCloudConfig,
  type CloudFrame, type CloudLog, type CloudSnapshot, type CloudTerminal, type DesktopCloudConfig,
} from "./desktop-cloud-protocol.js";

type Scheduling = { priority: "background"; source: string; signal: AbortSignal };
// Deliberately narrow: no sendInternalRequest, resume, turn/start, approvals,
// authentication getters, raw transport or execution methods in this interface.
export interface CloudReadConnection {
  readThread(id: string, options: { includeTurns: false; threadAccess: "shared" }, scheduling: Scheduling): Promise<unknown>;
  listThreadTurns(id: string, options: { limit: number; itemsView: "full" }, scheduling: Scheduling): Promise<unknown>;
  registerInternalNotificationHandler(handler: (event: unknown) => void): () => void;
  registerInternalAuthenticatedPrincipalChangeHandler(handler: () => void): () => void;
  registerInternalConnectionStateHandler(handler: (state: string) => void): () => void;
  getConnectionState(): string;
}
export interface CloudConnectionRegistry {
  subscribe(handler: (event: { type: "added" | "removed"; hostId: string; connection: CloudReadConnection }) => void): () => void;
}
type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const safeId = (value: unknown): string => /^[A-Za-z0-9_.:-]{1,128}$/u.test(text(value)) ? text(value) : "";
const millis = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value < 1e12 ? value * 1000 : value) : null;
const terminalStatus = (value: unknown): value is "completed" | "failed" | "interrupted" => ["completed", "failed", "interrupted"].includes(text(value));

export function cloudMessages(turnValue: unknown): CloudSnapshot["messages"] {
  const turn = object(turnValue), turnId = safeId(turn.id);
  if (!turnId) return [];
  return array(turn.items).flatMap((entry): CloudSnapshot["messages"] => {
    const wrapper = object(entry), item = object(wrapper.item ?? entry), id = safeId(item.id);
    if (!id || (item.type !== "userMessage" && item.type !== "agentMessage")) return [];
    // Never forward reasoning, tools, approval capabilities or arbitrary item JSON.
    let body = item.type === "agentMessage" ? text(item.text) : array(item.content)
      .filter((part) => object(part).type === "text").map((part) => text(object(part).text)).join("\n");
    if (!body.trim()) return [];
    if (body.length > 4_000) body = `${body.slice(0, 3_950)}\n[Message continues in Codex.]`;
    return [{ id, turnId, role: item.type === "userMessage" ? "user" : "assistant", kind: "message", text: body,
      phase: item.phase === "commentary" || item.phase === "final_answer" ? item.phase : "unknown",
      approvalId: null, canControl: false, resolved: true }];
  }).slice(-20);
}

type TargetState = {
  snapshot: CloudSnapshot; seeded: boolean; busy: boolean; revision: number;
  completed: Set<string>; buffered: unknown[]; lastSnapshot: string; publishedAt: number; failures: number; nextReadAt: number;
  pending: Map<string, { turn: RecordValue; source: CloudTerminal["source"]; observedAt: number; timer: NodeJS.Timeout }>;
};
export class DesktopCloudObserver {
  private readonly targets = new Map<string, TargetState>();
  private readonly removers: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;
  private epoch = 0;
  private disposed = false;
  private controller = new AbortController();
  constructor(private readonly config: DesktopCloudConfig, private readonly connection: CloudReadConnection,
    private readonly emitSnapshot: (snapshot: CloudSnapshot, at: number) => void,
    private readonly emitTerminal: (event: CloudTerminal) => void,
    private readonly reset: () => void, private readonly log: CloudLog = logDesktopCloud) {
    for (const target of config.targets) this.targets.set(target.threadId, {
      snapshot: { threadId: target.threadId, title: target.title, status: "notLoaded", messages: [] },
      seeded: false, busy: false, revision: 0, completed: new Set(), buffered: [], lastSnapshot: "", publishedAt: 0, failures: 0, nextReadAt: 0,
      pending: new Map(),
    });
  }
  start(): void {
    this.removers.push(this.connection.registerInternalNotificationHandler((event) => this.notification(event)),
      this.connection.registerInternalAuthenticatedPrincipalChangeHandler(() => this.invalidate()),
      this.connection.registerInternalConnectionStateHandler((state) => {
        if (state === "connected") void this.reconcile();
        else {
          this.controller.abort(); this.controller = new AbortController();
          for (const state of this.targets.values()) { state.snapshot.status = "notLoaded"; this.publish(state); }
        }
      }));
    this.timer = setInterval(() => { void this.reconcile(); }, this.config.reconcileMs);
    this.timer.unref();
    void this.reconcile();
  }
  private invalidate(): void {
    this.epoch++; this.controller.abort(); this.controller = new AbortController();
    this.reset();
    for (const state of this.targets.values()) {
      for (const entry of state.pending.values()) clearTimeout(entry.timer);
      state.pending.clear();
      state.seeded = false; state.completed.clear(); state.buffered = []; state.lastSnapshot = ""; state.nextReadAt = 0;
      state.snapshot = { ...state.snapshot, status: "notLoaded", messages: [] };
    }
    this.log("account_reset");
  }
  dispose(): void {
    this.disposed = true; this.epoch++; this.controller.abort();
    if (this.timer) clearInterval(this.timer);
    for (const state of this.targets.values()) for (const entry of state.pending.values()) clearTimeout(entry.timer);
    for (const remove of this.removers) remove();
  }
  async reconcile(): Promise<void> {
    if (this.disposed || this.connection.getConnectionState() !== "connected") return;
    await Promise.all([...this.targets].map(async ([threadId, state]) => {
      if (state.busy || state.nextReadAt > Date.now()) return;
      state.busy = true;
      const epoch = this.epoch, revision = state.revision, startedAt = Date.now();
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(5_000)]);
      const scheduling: Scheduling = { priority: "background", source: "thread_hydration", signal };
      try {
        if (!state.seeded) {
          const thread = object(await this.connection.readThread(threadId, { includeTurns: false, threadAccess: "shared" }, scheduling));
          if (thread.id !== threadId) throw new Error("Thread access could not be verified");
        }
        const page = object(await this.connection.listThreadTurns(threadId, { limit: 3, itemsView: "full" }, scheduling));
        if (epoch !== this.epoch || this.disposed || signal.aborted) return;
        if (!Array.isArray(page.data)) throw new Error("Unsupported cloud history shape");
        const turns = page.data.map((turn) => object(object(turn).turn ?? turn));
        // App Server's default turns page is newest first. Only these three
        // turns are retained; this observer never downloads the full history.
        const ordered = [...turns].reverse();
        const messages = ordered.flatMap(cloudMessages).slice(-20);
        if (state.revision === revision) {
          state.snapshot.messages = messages;
          state.snapshot.status = turns.some((turn) => turn.status === "inProgress") ? "active" :
            turns[0]?.status === "failed" ? "error" : "idle";
        }
        for (const turn of ordered) if (terminalStatus(turn.status) && safeId(turn.id)) {
          if (!state.seeded) state.completed.add(text(turn.id));
          else this.completed(state, turn, "reconcile", Date.now());
        }
        const first = !state.seeded;
        state.seeded = true; state.failures = 0;
        this.publish(state);
        for (const event of state.buffered.splice(0)) {
          // A completion observed while the baseline read was in flight is new.
          const value = object(event), params = object(value.params);
          if (value.method === "turn/completed") state.completed.delete(text(object(params.turn).id));
          this.notification(event);
        }
        if (first) this.log("ready", { threadId, readMs: Date.now() - startedAt });
      } catch {
        if (!this.disposed && epoch === this.epoch) {
          state.failures++;
          state.nextReadAt = Date.now() + Math.min(30_000, this.config.reconcileMs * 2 ** Math.min(state.failures - 1, 4));
          if (state.failures === 1 || state.failures % 30 === 0) this.log("read_failed", { threadId, failures: state.failures });
        }
      } finally { state.busy = false; }
    }));
  }
  notification(value: unknown): void {
    if (this.disposed || this.connection.getConnectionState() !== "connected") return;
    const event = object(value), params = object(event.params), state = this.targets.get(text(params.threadId));
    if (!state) return;
    if (!["turn/started", "turn/completed", "item/completed", "item/agentMessage/delta"].includes(text(event.method))) return;
    if (!state.seeded) { if (state.buffered.length < 80) state.buffered.push(value); return; }
    state.revision++;
    const observedAt = Date.now(), turnId = safeId(params.turnId), itemId = safeId(params.itemId);
    if (event.method === "turn/started") state.snapshot.status = "active";
    if (event.method === "item/agentMessage/delta" && turnId && itemId) {
      let message = state.snapshot.messages.find((item) => item.id === itemId && item.turnId === turnId);
      if (!message) {
        message = { id: itemId, turnId, role: "assistant", kind: "message", text: "", phase: "unknown",
          approvalId: null, canControl: false, resolved: true };
        state.snapshot.messages.push(message);
      }
      message.text = (message.text + text(params.delta)).slice(0, 4_000);
    }
    if (event.method === "item/completed" && turnId) {
      this.mergeMessages(state, cloudMessages({ id: turnId, items: [params.item] }));
      const pending = state.pending.get(turnId);
      if (pending) this.completed(state, pending.turn, pending.source, pending.observedAt);
    }
    if (event.method === "turn/completed") {
      const turn = object(params.turn);
      if (!terminalStatus(turn.status) || !safeId(turn.id)) return;
      this.mergeMessages(state, cloudMessages(turn));
      state.snapshot.status = turn.status === "failed" ? "error" : "idle";
      this.completed(state, turn, "notification", observedAt);
    }
    state.snapshot.messages = state.snapshot.messages.slice(-20);
    this.publish(state);
  }
  private mergeMessages(state: TargetState, messages: CloudSnapshot["messages"]): void {
    for (const message of messages) {
      const index = state.snapshot.messages.findIndex((old) => old.id === message.id && old.turnId === message.turnId);
      if (index >= 0) state.snapshot.messages[index] = message; else state.snapshot.messages.push(message);
    }
  }
  private publish(state: TargetState): void {
    // Bound UTF-8 bytes as well as character count (e.g. emoji-heavy replies).
    let bytes = 0;
    state.snapshot.messages = state.snapshot.messages.slice(-20).reverse().filter((message) => {
      bytes += Buffer.byteLength(message.text); return bytes <= 48_000;
    }).reverse();
    const encoded = JSON.stringify(state.snapshot);
    if (encoded === state.lastSnapshot && Date.now() - state.publishedAt < 10_000) return;
    state.lastSnapshot = encoded; state.publishedAt = Date.now();
    this.emitSnapshot(structuredClone(state.snapshot), Date.now());
  }
  private completed(state: TargetState, turn: RecordValue, source: CloudTerminal["source"], observedAt: number, allowPlaceholder = false): void {
    const turnId = text(turn.id);
    if (state.completed.has(turnId)) return;
    const pending = state.pending.get(turnId);
    if (pending) { source = pending.source; observedAt = pending.observedAt; }
    const final = cloudMessages(turn).filter((m) => m.role === "assistant" && m.phase === "final_answer").at(-1)?.text ??
      state.snapshot.messages.filter((m) => m.turnId === turnId && m.role === "assistant" && m.phase === "final_answer").at(-1)?.text;
    // Completion notifications can omit items. Prefer the actual final reply;
    // one bounded hydration runs immediately, with a 2.5 s ceiling before a
    // truthful "reply ready" notification if history is unavailable.
    if (turn.status === "completed" && !final?.trim() && !allowPlaceholder) {
      if (!pending && state.pending.size < 4) {
        const metadata = { id: turn.id, status: turn.status, completedAt: turn.completedAt };
        const timer = setTimeout(() => this.completed(state, metadata, source, observedAt, true), 2_500);
        timer.unref(); state.pending.set(turnId, { turn: metadata, source, observedAt, timer });
        void this.reconcile();
      }
      return;
    }
    if (pending) { clearTimeout(pending.timer); state.pending.delete(turnId); }
    state.completed.add(turnId);
    if (state.completed.size > 128) state.completed.delete(state.completed.values().next().value!);
    const nativeCompletedAt = millis(turn.completedAt);
    if (nativeCompletedAt !== null && observedAt - nativeCompletedAt > CLOUD_MAX_AGE_MS) {
      this.log("stale_terminal", { threadId: state.snapshot.threadId, turnId }); return;
    }
    const kind = `terminal.${text(turn.status)}` as CloudTerminal["kind"];
    const detail = kind === "terminal.completed" ? final?.trim().split(/\s+/u).slice(0, 30).join(" ").slice(0, 400) || "The cloud reply is ready. Open the chat to read it." :
      kind === "terminal.failed" ? "The cloud response stopped with an error. Open Codex for details." : "The cloud response was interrupted.";
    this.emitTerminal({ eventId: cloudEventId(state.snapshot.threadId, turnId, kind), threadId: state.snapshot.threadId,
      turnId, kind, turnScope: "topLevel", title: state.snapshot.title, detail, occurredAt: nativeCompletedAt ?? observedAt,
      nativeCompletedAt, observedAt, source });
  }
}

// Acknowledged, bounded local outbox. Voice control has its own bounded lane:
// an in-flight notification delivery must not block native call negotiation.
// Streaming snapshots coalesce, never queue behind every token.
export class DesktopCloudTransport {
  private socket: Socket | null = null;
  private retry: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private streamId = randomUUID();
  private pending = new Map<string, CloudFrame>();
  private snapshots = new Map<string, CloudFrame>();
  private inFlight: CloudFrame | null = null;
  private readonly voiceInFlight = new Set<string>();
  private closed = false;
  constructor(private readonly config: DesktopCloudConfig, private readonly socketPath: string, private readonly log: CloudLog = logDesktopCloud,
    private readonly onSend?: (command: CloudSend) => Promise<CloudSendResult>,
    private readonly onVoice?: (command: NativeVoiceCommand) => void,
    private readonly onVoiceDisconnected?: () => void) {}
  start(): void { this.connect(); }
  snapshot(snapshot: CloudSnapshot, observedAt: number): void {
    const frame: CloudFrame = { version: 1, kind: "snapshot", id: randomUUID(), streamId: this.streamId, snapshot, observedAt };
    this.snapshots.set(snapshot.threadId, frame);
    this.pending.set(`snapshot:${snapshot.threadId}`, frame);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, 150);
  }
  terminal(event: CloudTerminal): void {
    if (this.pending.size >= 132) { this.log("outbox_full", { eventId: event.eventId }); return; }
    this.pending.set(event.eventId, { version: 1, kind: "terminal", id: event.eventId, streamId: this.streamId, event }); this.flush();
  }
  voiceEvent(value: NativeVoiceEvent): void {
    if (!this.socket || this.socket.connecting || this.socket.destroyed) throw new Error("The private bridge disconnected");
    if (this.voiceInFlight.size >= 16) throw new Error("The native voice receiver queue is full");
    const event = nativeVoiceEventSchema.parse(value), id = randomUUID();
    const frame: CloudFrame = { version: 1, kind: "native-voice-event", id, streamId: this.streamId, event };
    this.voiceInFlight.add(id);
    this.socket.write(`${JSON.stringify(frame)}\n`);
  }
  reset(): void {
    this.pending.clear(); this.snapshots.clear(); this.inFlight = null; this.voiceInFlight.clear(); this.streamId = randomUUID();
    this.pending.set("reset", { version: 1, kind: "reset", id: randomUUID(), streamId: this.streamId });
    this.socket?.destroy();
  }
  close(): void {
    this.closed = true; this.pending.clear(); this.voiceInFlight.clear(); this.socket?.destroy();
    if (this.retry) clearTimeout(this.retry);
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }
  private connect(): void {
    if (this.closed) return;
    const socket = createConnection(this.socketPath); this.socket = socket;
    let input = "";
    socket.setEncoding("utf8");
    socket.setTimeout(15_000, () => { if (this.inFlight || this.voiceInFlight.size) socket.destroy(); });
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ version: 1, kind: "hello", capability: this.config.capability,
        pairBinding: this.config.pairBinding, streamId: this.streamId })}\n`);
      for (const [threadId, frame] of this.snapshots) if (!this.pending.has(`snapshot:${threadId}`)) this.pending.set(`snapshot:${threadId}`, frame);
      this.log("connected"); this.flush();
    });
    socket.on("data", (chunk: string) => {
      if (this.socket !== socket || this.closed) return;
      input += chunk;
      if (Buffer.byteLength(input) > CLOUD_FRAME_BYTES) { socket.destroy(); return; }
      let newline;
      while ((newline = input.indexOf("\n")) >= 0) {
        const line = input.slice(0, newline); input = input.slice(newline + 1);
        try {
          const raw: unknown = JSON.parse(line);
          const voice = nativeVoiceCommandSchema.safeParse(raw);
          if (voice.success) { this.onVoice?.(voice.data); continue; }
          const command = cloudSendSchema.safeParse(raw);
          if (command.success) {
            const value = command.data;
            const fallback: CloudSendResult = {requestId:value.requestId, threadId:value.threadId,
              outcome:"rejected", message:"This receiver does not support text replies."};
            void (this.onSend ? this.onSend(value) : Promise.resolve(fallback)).catch(():CloudSendResult => ({
              ...fallback, outcome:"uncertain", message:"Browser send outcome is uncertain; check the chat before retrying."})).then(result => {
              const frame: CloudFrame = {version:1,kind:"send-result",id:randomUUID(),streamId:this.streamId,
                result:cloudSendResultSchema.parse(result)};
              this.pending.set(`result:${value.requestId}`,frame); this.flush();
            }).catch(() => { this.log("send_result_invalid"); });
            continue;
          }
          const ack = cloudAckSchema.parse(raw);
          if (this.voiceInFlight.delete(ack.id)) continue;
          if (ack.id !== this.inFlight?.id) { socket.destroy(); return; }
          this.inFlight = null; this.flush();
        } catch { socket.destroy(); return; }
      }
    });
    socket.on("error", () => {}); // Close owns reconnection; never log socket paths or content.
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.voiceInFlight.clear();
      this.onVoiceDisconnected?.();
      for (const [key, frame] of this.pending) if (frame.kind === "native-voice-event") this.pending.delete(key);
      if (this.inFlight && this.inFlight.kind !== "native-voice-event") {
        const key = this.inFlight.kind === "snapshot" ? `snapshot:${this.inFlight.snapshot.threadId}` : this.inFlight.id;
        if (!this.pending.has(key)) this.pending.set(key, this.inFlight);
      }
      this.inFlight = null;
      if (!this.closed) { this.retry = setTimeout(() => { this.retry = null; this.connect(); }, 1_000); this.retry.unref(); }
    });
  }
  private flush(): void {
    if (!this.socket || this.socket.connecting || this.socket.destroyed || this.inFlight) return;
    const entries = [...this.pending.entries()];
    const entry = entries.find(([, frame]) => frame.kind === "reset") ?? entries.find(([, frame]) => frame.kind === "native-voice-event") ?? entries.find(([, frame]) => frame.kind === "terminal") ?? entries[0];
    if (!entry) return;
    const [key, frame] = entry; this.pending.delete(key);
    if (frame.kind === "terminal" && Date.now() - frame.event.observedAt > CLOUD_MAX_AGE_MS) { this.flush(); return; }
    const encoded = `${JSON.stringify(frame)}\n`;
    if (Buffer.byteLength(encoded) > CLOUD_FRAME_BYTES) { this.log("frame_too_large"); this.flush(); return; }
    this.inFlight = frame; this.socket.write(encoded);
  }
}

export function startAgenticWearCloudAdapter(registry: CloudConnectionRegistry, configFile = desktopCloudConfigPath()): { dispose(): void } {
  let stopped = false, remove: (() => void) | undefined, observer: DesktopCloudObserver | undefined, transport: DesktopCloudTransport | undefined;
  void readDesktopCloudConfig(configFile).then((config) => {
    if (!config?.enabled || stopped) return;
    transport = new DesktopCloudTransport(config, desktopCloudSocketPath(configFile)); transport.start();
    remove = registry.subscribe((event) => {
      if (event.hostId !== "durable") return;
      observer?.dispose(); observer = undefined;
      if (event.type === "removed") { transport?.reset(); return; }
      try {
        for (const method of ["readThread", "listThreadTurns", "registerInternalNotificationHandler",
          "registerInternalAuthenticatedPrincipalChangeHandler", "registerInternalConnectionStateHandler", "getConnectionState"] as const) {
          if (typeof event.connection[method] !== "function") throw new Error("Desktop cloud API changed");
        }
        observer = new DesktopCloudObserver(config, event.connection,
          (snapshot, at) => transport?.snapshot(snapshot, at), (terminal) => transport?.terminal(terminal), () => transport?.reset());
        observer.start();
      } catch { observer?.dispose(); transport?.reset(); logDesktopCloud("unsupported_desktop_api"); }
    });
  }).catch(() => { logDesktopCloud("disabled_invalid_config_or_api"); observer?.dispose(); transport?.close(); });
  return { dispose() { stopped = true; remove?.(); observer?.dispose(); transport?.close(); } };
}
