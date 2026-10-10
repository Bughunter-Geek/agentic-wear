import WebSocket from "ws";
import { MAX_RELAY_MESSAGE_BYTES } from "./limits.js";
import { z } from "zod";
import { relaySocketMessageSchema, wireEnvelopeSchema, type WireEnvelope } from "./schemas.js";

const userAgent = "OpenAI File Downloader, XaiImageApiFetch/1.0";
const HEARTBEAT_INTERVAL_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 50_000;
const pairStartResponseSchema = z.object({
  pairId: z.string().length(43),
  bridgeCredential: z.string().min(32),
  expiresInSeconds: z.number().int().positive(),
}).strict();
const pairStatusSchema = z.object({
  paired: z.boolean(),
  watchPublicKey: z.string().nullable(),
  watchProof: z.string().length(43).nullable(),
}).strict();
const pairConfirmationSchema = z.object({ paired: z.literal(true) }).strict();

export type PairStartResponse = z.infer<typeof pairStartResponseSchema>;

export class RelayClient {
  constructor(
    private readonly relayUrl: string,
    private readonly pairId?: string,
    private readonly credential?: string,
  ) {
    const parsed = new URL(relayUrl);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname))) {
      throw new Error("Relay URLs must use HTTPS outside local development");
    }
  }

  async startPairing(pairId: string, bridgePublicKey: string, bootstrapSecret: string): Promise<PairStartResponse> {
    const value = await this.jsonRequest("/v1/pair/start", {
      method: "POST",
      credential: bootstrapSecret,
      body: { pairId, bridgePublicKey },
      maxResponseBytes: 8_192,
    });
    const result = pairStartResponseSchema.parse(value);
    if (result.pairId !== pairId) throw new Error("Relay returned a different pairing identifier");
    return result;
  }

  async status(): Promise<z.infer<typeof pairStatusSchema>> {
    this.requirePair();
    return pairStatusSchema.parse(await this.jsonRequest(`/v1/pairs/${this.pairId}/status`, {
      method: "GET",
      credential: this.credential,
      maxResponseBytes: 8_192,
    }));
  }

  async confirmPairing(watchPublicKey: string, watchProof: string, bridgeProof: string): Promise<void> {
    this.requirePair();
    pairConfirmationSchema.parse(await this.jsonRequest(`/v1/pairs/${this.pairId}/confirm-bridge`, {
      method: "POST",
      credential: this.credential,
      body: { watchPublicKey, watchProof, bridgeProof },
      maxResponseBytes: 8_192,
    }));
  }

  async sendToWatch(envelope: WireEnvelope): Promise<void> {
    this.requirePair();
    wireEnvelopeSchema.parse(envelope);
    let lastError: unknown;
    for (const delayMs of [0, 250, 1_000]) {
      if (delayMs > 0) await delay(delayMs);
      try {
        await this.jsonRequest(`/v1/pairs/${this.pairId}/to-watch`, {
          method: "POST",
          credential: this.credential,
          body: envelope,
          maxResponseBytes: 8_192,
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Relay delivery failed");
  }

  async runSocket(
    signal: AbortSignal,
    onEnvelope: (envelope: WireEnvelope, localQueueMs?: number) => Promise<void>,
    onWatchPublicKey: (publicKey: string) => Promise<void>,
  ): Promise<void> {
    this.requirePair();
    let reconnectDelay = 500;
    while (!signal.aborted) {
      try {
        await this.connectOnce(signal, onEnvelope, onWatchPublicKey, () => { reconnectDelay = 500; });
        reconnectDelay = 500;
      } catch (error) {
        if (signal.aborted) return;
        console.error(JSON.stringify({ level: "error", message: "relay socket disconnected", error: safeError(error) }));
      }
      if (signal.aborted) return;
      await delay(reconnectDelay, signal);
      reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
    }
  }

  private async connectOnce(
    signal: AbortSignal,
    onEnvelope: (envelope: WireEnvelope, localQueueMs?: number) => Promise<void>,
    onWatchPublicKey: (publicKey: string) => Promise<void>,
    onConnected: () => void,
  ): Promise<void> {
    const endpoint = new URL(`${this.relayUrl.replace(/\/$/u, "")}/v1/pairs/${this.pairId}/bridge`);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(endpoint, {
        handshakeTimeout: 10_000,
        headers: { Authorization: `Bearer ${this.credential}`, "User-Agent": userAgent },
      });
      let chain = Promise.resolve();
      let settled = false;
      let pendingPing: { at: number; sentAt: number } | null = null;
      let lastPingAt = 0;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        signal.removeEventListener("abort", abort);
        if (error) reject(error); else resolve();
      };
      const heartbeat = setInterval(() => {
        if (settled || socket.readyState !== WebSocket.OPEN) return;
        if (pendingPing) {
          if (performance.now() - pendingPing.sentAt >= HEARTBEAT_TIMEOUT_MS) {
            finish(new Error("Relay heartbeat timed out"));
            socket.terminate();
          }
          return;
        }
        lastPingAt = Math.max(Date.now(), lastPingAt + 1);
        pendingPing = { at: lastPingAt, sentAt: performance.now() };
        socket.send(JSON.stringify({ type: "ping", at: pendingPing.at }), (error) => {
          if (error) { finish(new Error("Relay heartbeat send failed")); socket.terminate(); }
        });
      }, HEARTBEAT_INTERVAL_MS);
      heartbeat.unref();
      const abort = () => { finish(); socket.terminate(); };
      signal.addEventListener("abort", abort, { once: true });
      socket.on("open", () => {
        if (settled || signal.aborted) return;
        onConnected();
        console.log(JSON.stringify({ level: "info", message: "relay socket connected" }));
      });
      socket.on("message", (raw, binary) => {
        if (settled || signal.aborted) return;
        const receivedAt = performance.now();
        let parsed: z.infer<typeof relaySocketMessageSchema>;
        try {
          if (binary || rawLength(raw) > MAX_RELAY_MESSAGE_BYTES) throw new Error("Relay sent an invalid message");
          parsed = relaySocketMessageSchema.parse(JSON.parse(raw.toString("utf8")));
        } catch { socket.close(1008, "Invalid relay message"); return; }
        // Transport replies bypass queued local work so slow transcription
        // cannot make a responsive relay appear disconnected.
        if (parsed.type === "pong") {
          if (pendingPing?.at === parsed.at) pendingPing = null;
          return;
        }
        chain = chain.then(async () => {
          if (settled || signal.aborted) return;
          if (parsed.type === "envelope") await onEnvelope(parsed.envelope, performance.now() - receivedAt);
          else if ((parsed.type === "pair.challenge" || parsed.type === "pair.status") && parsed.watchPublicKey) {
            await onWatchPublicKey(parsed.watchPublicKey);
          }
        });
        // RFC6455 close reasons are limited to123 UTF-8 bytes. Zod errors
        // can exceed that bound and contain payload details; send neither.
        void chain.catch(() => socket.close(1008, "Invalid relay message"));
      });
      socket.once("error", (error) => { finish(error); socket.terminate(); });
      socket.once("close", (code) => {
        if (signal.aborted || code === 1000) finish();
        else finish(new Error(`Relay WebSocket closed (${code})`));
      });
      if (signal.aborted) abort();
    });
  }

  private async jsonRequest(
    path: string,
    options: {
      method: "GET" | "POST" | "PUT";
      credential?: string;
      body?: unknown;
      maxResponseBytes: number;
    },
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": userAgent };
    if (options.credential) headers.Authorization = `Bearer ${options.credential}`;
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";
    const response = await fetch(`${this.relayUrl.replace(/\/$/u, "")}${path}`, {
      method: options.method,
      headers,
      body,
      signal: AbortSignal.timeout(25_000),
    });
    const text = await boundedText(response, options.maxResponseBytes);
    const parsed: unknown = text.length === 0 ? {} : JSON.parse(text);
    if (!response.ok) {
      const message = z.object({ error: z.string() }).passthrough().safeParse(parsed);
      throw new Error(message.success ? message.data.error : `Relay request failed (${response.status})`);
    }
    return parsed;
  }

  private requirePair(): void {
    if (!this.pairId || !this.credential) throw new Error("Relay pairing is not configured");
  }
}

async function boundedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error("Relay response is too large");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf8", { fatal: true }).decode(bytes);
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function rawLength(value: WebSocket.RawData): number {
  return Array.isArray(value) ? value.reduce((total, item) => total + item.byteLength, 0) : value.byteLength;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown error").slice(0, 160);
}
