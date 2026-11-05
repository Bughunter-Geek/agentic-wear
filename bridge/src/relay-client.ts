import WebSocket from "ws";
import { z } from "zod";
import { relaySocketMessageSchema, wireEnvelopeSchema, type WireEnvelope } from "./schemas.js";

const userAgent = "OpenAI File Downloader, XaiImageApiFetch/1.0";
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

export interface RelaySocketTiming {
  /** Interval between application-level pings sent to the relay. */
  heartbeatMs: number;
  /**
   * Close and reconnect when nothing (not even a pong) arrives for this long.
   * Without it a half-open TCP connection — typical after macOS sleep/wake or
   * a Wi-Fi change — leaves the bridge "connected" forever while the watch
   * never receives anything.
   */
  livenessTimeoutMs: number;
  initialReconnectMs: number;
  maxReconnectMs: number;
}

const defaultSocketTiming: RelaySocketTiming = {
  heartbeatMs: 25_000,
  livenessTimeoutMs: 75_000,
  initialReconnectMs: 500,
  maxReconnectMs: 15_000,
};

export class RelayClient {
  private readonly timing: RelaySocketTiming;

  constructor(
    private readonly relayUrl: string,
    private readonly pairId?: string,
    private readonly credential?: string,
    timing: Partial<RelaySocketTiming> = {},
  ) {
    this.timing = { ...defaultSocketTiming, ...timing };
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
    onEnvelope: (envelope: WireEnvelope) => Promise<void>,
    onWatchPublicKey: (publicKey: string) => Promise<void>,
  ): Promise<void> {
    this.requirePair();
    let reconnectDelay = this.timing.initialReconnectMs;
    while (!signal.aborted) {
      try {
        await this.connectOnce(signal, onEnvelope, onWatchPublicKey);
        reconnectDelay = this.timing.initialReconnectMs;
      } catch (error) {
        if (signal.aborted) return;
        console.error(JSON.stringify({ level: "error", message: "relay socket disconnected", error: safeError(error) }));
      }
      // Stopping during the back-off is a normal shutdown, not an error.
      if (!(await delay(reconnectDelay, signal).then(() => true, () => false))) return;
      reconnectDelay = Math.min(reconnectDelay * 2, this.timing.maxReconnectMs);
    }
  }

  private async connectOnce(
    signal: AbortSignal,
    onEnvelope: (envelope: WireEnvelope) => Promise<void>,
    onWatchPublicKey: (publicKey: string) => Promise<void>,
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
      let lastActivity = Date.now();
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const heartbeat = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastActivity > this.timing.livenessTimeoutMs) {
          // terminate() destroys the TCP socket immediately; close() would wait
          // for a closing handshake the dead peer never answers.
          fail(new Error("Relay WebSocket stopped responding"));
          socket.terminate();
          return;
        }
        socket.send(JSON.stringify({ type: "ping", at: Date.now() }));
      }, Math.min(this.timing.heartbeatMs, this.timing.livenessTimeoutMs));
      heartbeat.unref();
      const abort = () => socket.close(1000, "Bridge stopping");
      signal.addEventListener("abort", abort, { once: true });
      socket.on("open", () => {
        lastActivity = Date.now();
        console.log(JSON.stringify({ level: "info", message: "relay socket connected" }));
      });
      socket.on("message", (raw, binary) => {
        lastActivity = Date.now();
        chain = chain.then(async () => {
          if (binary || rawLength(raw) > 800 * 1_024) throw new Error("Relay sent an invalid message");
          const parsed = relaySocketMessageSchema.parse(JSON.parse(raw.toString("utf8")));
          if (parsed.type === "envelope") await onEnvelope(parsed.envelope);
          else if ((parsed.type === "pair.challenge" || parsed.type === "pair.status") && parsed.watchPublicKey) {
            await onWatchPublicKey(parsed.watchPublicKey);
          }
        });
        void chain.catch((error: unknown) => socket.close(1008, safeError(error)));
      });
      // `on`, not `once`: ws may emit more than one error for a failing
      // socket, and an unhandled second "error" event would crash the bridge.
      socket.on("error", (error) => fail(error));
      socket.once("close", (code) => {
        clearInterval(heartbeat);
        signal.removeEventListener("abort", abort);
        if (settled) return;
        settled = true;
        if (signal.aborted || code === 1000) resolve();
        else reject(new Error(`Relay WebSocket closed (${code})`));
      });
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
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    // Remove the abort listener when the timer fires; otherwise every
    // reconnect attempt during a long outage leaks one listener on the
    // bridge-lifetime signal.
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function rawLength(value: WebSocket.RawData): number {
  return Array.isArray(value) ? value.reduce((total, item) => total + item.byteLength, 0) : value.byteLength;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown error").slice(0, 160);
}
