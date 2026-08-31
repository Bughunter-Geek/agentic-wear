import { stat } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export type CodexAppToolsRoute = {
  socketPath: string;
};

export type CodexAppMessage = {
  threadId: string;
  prompt: string;
  model: string | null;
  thinking: string;
  requestId: string;
};

export type CodexAppTurnSubmitter = {
  sendMessageToThread(
    message: CodexAppMessage,
    beforeDispatch: () => Promise<void>,
  ): Promise<void>;
  close(): Promise<void>;
};

const relayResponseSchema = z.object({
  id: z.string(),
  result: z.object({
    threadId: z.string().min(1).optional(),
    ok: z.boolean().optional(),
  }).optional(),
  error: z.object({ message: z.string().min(1) }).optional(),
}).passthrough();

export class CodexAppToolsClient implements CodexAppTurnSubmitter {
  private sequence: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly resolveRoute: () => Promise<CodexAppToolsRoute | null> = resolveCodexAppToolsRoute,
  ) {}

  sendMessageToThread(
    message: CodexAppMessage,
    beforeDispatch: () => Promise<void>,
  ): Promise<void> {
    const task = this.sequence
      .catch(() => undefined)
      .then(() => this.sendMessageNow(message, beforeDispatch));
    this.sequence = task.catch(() => undefined);
    return task;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.sequence.catch(() => undefined);
  }

  private async sendMessageNow(
    message: CodexAppMessage,
    beforeDispatch: () => Promise<void>,
  ): Promise<void> {
    if (this.closed) throw new Error("Codex app relay is closed");
    const route = await this.resolveRoute();
    if (!route) throw new Error("Codex desktop same-chat relay is unavailable");
    const socket = await connect(route.socketPath);
    try {
      if (this.closed) throw new Error("Codex app relay is closed");
      const healthId = boundedCallId(`${message.requestId}-health`);
      const health = await request(socket, { id: healthId, method: "native_health" });
      if (health.id !== healthId || health.error || health.result?.ok !== true) {
        throw new Error(health.error?.message ?? "Codex desktop same-chat relay is unavailable");
      }
      await beforeDispatch();
      const id = boundedCallId(message.requestId);
      const response = await request(socket, {
        id,
        method: "send_message_to_thread",
        params: message,
      });
      if (response.id !== id) throw new Error("Codex app relay returned an unexpected response");
      if (response.error) throw new Error(response.error.message);
      if (response.result?.threadId !== message.threadId) {
        throw new Error("Codex app acknowledged the Watch prompt on an unexpected chat");
      }
    } finally {
      socket.destroy();
    }
  }
}

export async function resolveCodexAppToolsRoute(): Promise<CodexAppToolsRoute | null> {
  const socketPath = relaySocketPath();
  try {
    const metadata = await stat(socketPath);
    return metadata.isSocket() && metadata.uid === process.getuid?.()
      ? { socketPath }
      : null;
  } catch {
    return null;
  }
}

export function relaySocketPath(): string {
  return process.env.AGENTIC_WEAR_CODEX_RELAY_SOCKET?.trim() ||
    join(homedir(), ".agentic-wear", "codex-app-tools.sock");
}

function connect(socketPath: string): Promise<Socket> {
  return new Promise((resolveConnect, rejectConnect) => {
    const socket = createConnection(socketPath);
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectConnect(new Error("Codex app relay connection timed out"));
    }, CONNECT_TIMEOUT_MS);
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

function request(socket: Socket, payload: Record<string, unknown>): Promise<z.infer<typeof relayResponseSchema>> {
  return new Promise((resolveRequest, rejectRequest) => {
    let buffered = "";
    const timeout = setTimeout(() => {
      cleanup();
      rejectRequest(new Error("Codex app relay request timed out"));
    }, TOOL_CALL_TIMEOUT_MS);
    timeout.unref();
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onError = (error: Error) => {
      cleanup();
      rejectRequest(error);
    };
    const onClose = () => {
      cleanup();
      rejectRequest(new Error("Codex app relay closed before acknowledging the prompt"));
    };
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      if (Buffer.byteLength(buffered, "utf8") > MAX_RESPONSE_BYTES) {
        cleanup();
        rejectRequest(new Error("Codex app relay response was too large"));
        return;
      }
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      try {
        const response = relayResponseSchema.parse(JSON.parse(buffered.slice(0, newline)));
        cleanup();
        resolveRequest(response);
      } catch {
        cleanup();
        rejectRequest(new Error("Codex app relay returned an invalid response"));
      }
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    socket.write(`${JSON.stringify(payload)}\n`);
  });
}

function boundedCallId(requestId: string): string {
  return `agentic-wear-${requestId}`.slice(0, 128);
}

const CONNECT_TIMEOUT_MS = 2_000;
const TOOL_CALL_TIMEOUT_MS = 45_000;
const MAX_RESPONSE_BYTES = 64 * 1_024;
