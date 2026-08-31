import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const messageSchema = z.object({
  threadId: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().nullable(),
  thinking: z.string().min(1),
  requestId: z.string().min(1),
});
const relayRequestSchema = z.object({
  id: z.string().min(1).max(128),
  method: z.enum(["health", "native_health", "send_message_to_thread"]),
  params: messageSchema.optional(),
}).passthrough();
const nativeResponseSchema = z.union([
  z.object({
    id: z.union([z.string(), z.number()]),
    jsonrpc: z.literal("2.0"),
    result: z.unknown(),
  }).passthrough(),
  z.object({
    id: z.union([z.string(), z.number()]),
    jsonrpc: z.literal("2.0"),
    error: z.object({ code: z.number(), message: z.string() }).passthrough(),
  }).passthrough(),
]);
const toolsListSchema = z.object({
  tools: z.array(z.object({
    name: z.string(),
    namespace: z.string(),
  }).passthrough()),
}).passthrough();
const toolCallResultSchema = z.object({
  contentItems: z.array(z.object({
    type: z.string(),
    text: z.string().optional(),
  }).passthrough()),
  success: z.boolean(),
}).passthrough();
const sendMessageResultSchema = z.object({ threadId: z.string().min(1) }).passthrough();

type PendingNativeRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type RelayLeader = {
  native: NativeAppToolsClient;
  server: Server;
  sockets: Set<Socket>;
};

class NativeAppToolsClient {
  private socket: Socket | null = null;
  private connecting: Promise<void> | null = null;
  private nextId = 1;
  private pendingData = Buffer.alloc(0);
  private readonly pending = new Map<number, PendingNativeRequest>();
  private sendNamespace: string | null = null;

  constructor(private readonly pipePath: string) {}

  async ensureAvailable(): Promise<void> {
    await this.resolveSendNamespace();
  }

  async sendMessage(message: z.infer<typeof messageSchema> | undefined): Promise<{ threadId: string }> {
    if (!message) throw new Error("Watch follow-up payload is missing");
    const namespace = await this.resolveSendNamespace();
    const callId = boundedCallId(message.requestId);
    const argumentsValue: Record<string, unknown> = {
      threadId: message.threadId,
      prompt: message.prompt,
      thinking: message.thinking,
    };
    if (message.model !== null) argumentsValue.model = message.model;
    const raw = await this.request("tools/call", {
      arguments: argumentsValue,
      callId,
      namespace,
      threadId: message.threadId,
      tool: "send_message_to_thread",
      turnId: callId,
    });
    const result = toolCallResultSchema.parse(raw);
    const text = result.contentItems
      .filter((item) => item.type === "inputText" && item.text)
      .map((item) => item.text!)
      .join("\n")
      .trim();
    if (!result.success) throw new Error(text.slice(0, 500) || "Codex app rejected the Watch follow-up");
    const accepted = sendMessageResultSchema.parse(JSON.parse(text));
    if (accepted.threadId !== message.threadId) {
      throw new Error("Codex app acknowledged the Watch prompt on an unexpected chat");
    }
    return accepted;
  }

  close(): void {
    this.disconnect(new Error("Codex app tool pipe closed"));
  }

  private async resolveSendNamespace(): Promise<string> {
    if (this.sendNamespace) return this.sendNamespace;
    const result = toolsListSchema.parse(await this.request("tools/list", { threadStartKind: "all" }));
    const tool = result.tools.find(({ name }) => name === "send_message_to_thread");
    if (!tool) throw new Error("Codex desktop does not expose same-chat follow-ups");
    this.sendNamespace = tool.namespace;
    return tool.namespace;
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    await this.connect();
    const socket = this.socket;
    if (!socket) throw new Error("Codex app tool pipe is unavailable");
    const id = this.nextId++;
    const response = new Promise<unknown>((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`Codex app ${method} request timed out`));
      }, NATIVE_REQUEST_TIMEOUT_MS);
      timeout.unref();
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timeout });
    });
    socket.write(encodeFrame(JSON.stringify({ id, jsonrpc: "2.0", method, params })));
    return response;
  }

  private connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolveConnect, rejectConnect) => {
      const socket = createConnection(this.pipePath);
      const timeout = setTimeout(() => {
        socket.destroy();
        rejectConnect(new Error("Codex app tool pipe connection timed out"));
      }, NATIVE_CONNECT_TIMEOUT_MS);
      timeout.unref();
      const fail = (error: Error) => {
        clearTimeout(timeout);
        socket.destroy();
        rejectConnect(error);
      };
      socket.once("error", fail);
      socket.once("connect", () => {
        clearTimeout(timeout);
        socket.off("error", fail);
        this.socket = socket;
        this.connecting = null;
        socket.on("data", (chunk) => this.onData(socket, Buffer.from(chunk)));
        socket.on("error", (error) => this.onDisconnect(socket, error));
        socket.on("close", () => this.onDisconnect(socket, new Error("Codex app tool pipe closed")));
        resolveConnect();
      });
    }).catch((error: unknown) => {
      this.connecting = null;
      throw error;
    });
    return this.connecting;
  }

  private onData(socket: Socket, chunk: Buffer): void {
    if (this.socket !== socket) return;
    this.pendingData = Buffer.concat([this.pendingData, chunk]);
    while (this.pendingData.length >= 4) {
      const length = this.pendingData.readUInt32LE(0);
      if (length > MAX_NATIVE_FRAME_BYTES) {
        socket.destroy(new Error("Codex app tool response was too large"));
        return;
      }
      if (this.pendingData.length < length + 4) return;
      const payload = this.pendingData.subarray(4, length + 4);
      this.pendingData = this.pendingData.subarray(length + 4);
      let response;
      try {
        response = nativeResponseSchema.parse(JSON.parse(payload.toString("utf8")));
      } catch {
        socket.destroy(new Error("Codex app tool returned an invalid response"));
        return;
      }
      const pending = this.pending.get(Number(response.id));
      if (!pending) continue;
      clearTimeout(pending.timeout);
      this.pending.delete(Number(response.id));
      if ("error" in response && response.error &&
        typeof response.error === "object" && "message" in response.error &&
        typeof response.error.message === "string") {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  private onDisconnect(socket: Socket, error: Error): void {
    if (this.socket === socket) this.disconnect(error);
  }

  private disconnect(error: Error): void {
    this.socket?.destroy();
    this.socket = null;
    this.connecting = null;
    this.pendingData = Buffer.alloc(0);
    this.sendNamespace = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdin.once("close", stop);
  process.stdin.once("end", stop);
  const nativePipePath = process.env.CODEX_APP_TOOLS_PIPE_PATH?.trim();
  const relayTask = nativePipePath
    ? maintainRelay(relaySocketPath(), nativePipePath, controller.signal)
    : Promise.resolve();
  try {
    await serveMcp(controller.signal);
  } finally {
    controller.abort();
    await relayTask;
  }
}

async function serveMcp(signal: AbortSignal): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const abort = () => lines.close();
  signal.addEventListener("abort", abort, { once: true });
  try {
    for await (const line of lines) {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (message.id === undefined || typeof message.method !== "string") continue;
      let result: unknown;
      if (message.method === "initialize") {
        const params = typeof message.params === "object" && message.params
          ? message.params as Record<string, unknown>
          : {};
        result = {
          protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "agentic-wear-relay", version: "0.6.7" },
        };
      } else if (message.method === "tools/list") result = { tools: [] };
      else if (message.method === "ping") result = {};
      else {
        writeMcp({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        });
        continue;
      }
      writeMcp({ jsonrpc: "2.0", id: message.id, result });
    }
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function writeMcp(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function maintainRelay(socketPath: string, nativePipePath: string, signal: AbortSignal): Promise<void> {
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  while (!signal.aborted) {
    const leader = await tryStartRelay(socketPath, nativePipePath);
    if (leader) {
      await waitForAbort(signal);
      await closeRelay(leader, socketPath);
      return;
    }
    await delay(PASSIVE_RETRY_MS, signal);
  }
}

async function tryStartRelay(socketPath: string, nativePipePath: string): Promise<RelayLeader | null> {
  let leader = relayServer(nativePipePath);
  try {
    await listen(leader.server, socketPath);
  } catch (error) {
    closeUnstartedRelay(leader);
    if (!isAddressInUse(error)) throw error;
    if (await relayIsHealthy(socketPath)) return null;
    const metadata = await lstat(socketPath).catch(() => null);
    if (!metadata?.isSocket() || metadata.uid !== process.getuid?.()) return null;
    await unlink(socketPath).catch(() => undefined);
    leader = relayServer(nativePipePath);
    try {
      await listen(leader.server, socketPath);
    } catch (retryError) {
      closeUnstartedRelay(leader);
      if (isAddressInUse(retryError)) return null;
      throw retryError;
    }
  }
  await chmod(socketPath, 0o600);
  return leader;
}

function relayServer(nativePipePath: string): RelayLeader {
  const native = new NativeAppToolsClient(nativePipePath);
  const sockets = new Set<Socket>();
  let sequence: Promise<void> = Promise.resolve();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      if (Buffer.byteLength(buffered, "utf8") > MAX_RELAY_REQUEST_BYTES) {
        socket.destroy();
        return;
      }
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        let request;
        try {
          request = relayRequestSchema.parse(JSON.parse(line));
        } catch (error) {
          replyError(socket, "unknown", error);
          newline = buffered.indexOf("\n");
          continue;
        }
        if (request.method === "health") {
          reply(socket, request.id, { ok: true });
        } else {
          sequence = sequence
            .catch(() => undefined)
            .then(() => handleNativeRequest(socket, native, request));
        }
        newline = buffered.indexOf("\n");
      }
    });
  });
  return { native, server, sockets };
}

async function handleNativeRequest(
  socket: Socket,
  native: NativeAppToolsClient,
  request: z.infer<typeof relayRequestSchema>,
): Promise<void> {
  try {
    if (request.method === "native_health") {
      await native.ensureAvailable();
      reply(socket, request.id, { ok: true });
      return;
    }
    reply(socket, request.id, await native.sendMessage(request.params));
  } catch (error) {
    replyError(socket, request.id, error);
  }
}

function reply(socket: Socket, id: string, result: Record<string, unknown>): void {
  if (!socket.destroyed) socket.write(`${JSON.stringify({ id, result })}\n`);
}

function replyError(socket: Socket, id: string, error: unknown): void {
  const message = error instanceof Error ? error.message : "Codex app relay failed";
  if (!socket.destroyed) socket.write(`${JSON.stringify({ id, error: { message: message.slice(0, 500) } })}\n`);
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(socketPath, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
}

async function closeRelay(leader: RelayLeader, socketPath: string): Promise<void> {
  for (const socket of leader.sockets) socket.destroy();
  leader.native.close();
  await new Promise<void>((resolveClose) => leader.server.close(() => resolveClose()));
  await unlink(socketPath).catch(() => undefined);
}

function closeUnstartedRelay(leader: RelayLeader): void {
  for (const socket of leader.sockets) socket.destroy();
  leader.native.close();
}

async function relayIsHealthy(socketPath: string): Promise<boolean> {
  try {
    const socket = await connectWithTimeout(socketPath, HEALTH_TIMEOUT_MS);
    return await new Promise((resolveHealth) => {
      let data = "";
      const timeout = setTimeout(() => {
        socket.destroy();
        resolveHealth(false);
      }, HEALTH_TIMEOUT_MS);
      timeout.unref();
      socket.on("data", (chunk) => {
        data += chunk.toString("utf8");
        const newline = data.indexOf("\n");
        if (newline < 0) return;
        clearTimeout(timeout);
        socket.destroy();
        try {
          const parsed = JSON.parse(data.slice(0, newline)) as { result?: { ok?: boolean } };
          resolveHealth(parsed.result?.ok === true);
        } catch {
          resolveHealth(false);
        }
      });
      socket.write(`${JSON.stringify({ id: "health", method: "health" })}\n`);
    });
  } catch {
    return false;
  }
}

function connectWithTimeout(socketPath: string, timeoutMs: number): Promise<Socket> {
  return new Promise((resolveConnect, rejectConnect) => {
    const socket = createConnection(socketPath);
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectConnect(new Error("Relay health check timed out"));
    }, timeoutMs);
    timeout.unref();
    const onError = (error: Error) => {
      clearTimeout(timeout);
      rejectConnect(error);
    };
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.off("error", onError);
      resolveConnect(socket);
    });
    socket.once("error", onError);
  });
}

function encodeFrame(message: string): Buffer {
  const payload = Buffer.from(message, "utf8");
  if (payload.length > MAX_NATIVE_FRAME_BYTES) throw new Error("Codex app tool request was too large");
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function relaySocketPath(): string {
  return process.env.AGENTIC_WEAR_CODEX_RELAY_SOCKET?.trim() ||
    join(homedir(), ".agentic-wear", "codex-app-tools.sock");
}

function boundedCallId(requestId: string): string {
  return `agentic-wear-${requestId}`.slice(0, 128);
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveAbort) => signal.addEventListener("abort", () => resolveAbort(), { once: true }));
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveDelay) => {
    const timeout = setTimeout(resolveDelay, milliseconds);
    timeout.unref();
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolveDelay();
    }, { once: true });
  });
}

const NATIVE_CONNECT_TIMEOUT_MS = 2_000;
const NATIVE_REQUEST_TIMEOUT_MS = 45_000;
const MAX_NATIVE_FRAME_BYTES = 8 * 1_024 * 1_024;
const MAX_RELAY_REQUEST_BYTES = 256 * 1_024;
const HEALTH_TIMEOUT_MS = 500;
const PASSIVE_RETRY_MS = 2_000;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Agentic Wear relay failed");
    process.exitCode = 1;
  });
}
