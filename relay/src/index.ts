import { ZodError } from "zod";
import { deriveCredential, secureEqual, sha256Hex } from "./crypto";
import { wakeWatch } from "./fcm";
import { PairAdmissionError } from "./pair-admission";
import { PairRelayError } from "./pair-relay";
import {
  ackSchema,
  bridgePairingProofSchema,
  pairCompleteSchema,
  pairStartSchema,
  registrationSchema,
  watchPairingProofSchema,
  wireEnvelopeSchema,
} from "./schemas";

export { PairAdmission } from "./pair-admission";
export { PairRelay } from "./pair-relay";

const JSON_LIMIT = 800 * 1_024;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    try {
      const response = await route(request, env);
      log("info", "request completed", {
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return secureResponse(response);
    } catch (error) {
      const status = statusOf(error);
      const publicMessage = error instanceof ZodError
        ? "Invalid request"
        : status >= 500 ? "Relay request failed" : errorMessage(error);
      log("error", "request failed", {
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        error: errorMessage(error),
      });
      return secureResponse(Response.json({ error: publicMessage, requestId }, { status }));
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ ok: true, service: "agentic-wear-relay", version: 1 });
  }
  if (request.method === "POST" && url.pathname === "/v1/pair/start") {
    await requireBootstrap(request, env);
    const input = pairStartSchema.parse(await readJson(request, 4_096));
    const expiresAt = Date.now() + ttl(env.PAIR_CODE_TTL_SECONDS);
    const admission = pairAdmission(env);
    if (!(await admission.reserve(input.pairId, expiresAt, Date.now()))) {
      throw new HttpError(409, "Pairing identifier is already active");
    }
    const bridgeCredential = await deriveCredential(env.PAIRING_CREDENTIAL_SECRET, "bridge", input.pairId);
    const watchCredential = await deriveCredential(env.PAIRING_CREDENTIAL_SECRET, "watch", input.pairId);
    try {
      const created = await env.PAIR_RELAY.getByName(input.pairId).initializePair({
        pairId: input.pairId,
        bridgePublicKey: input.bridgePublicKey,
        bridgeAuthHash: await sha256Hex(bridgeCredential),
        watchAuthHash: await sha256Hex(watchCredential),
        expiresAt,
      });
      if (!created) throw new HttpError(409, "Pairing identifier is already active");
    } catch (error) {
      await admission.release(input.pairId);
      throw error;
    }
    return Response.json({
      pairId: input.pairId,
      bridgeCredential,
      expiresInSeconds: Number(env.PAIR_CODE_TTL_SECONDS),
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/pair/complete") {
    await enforcePairingRateLimits(request, env);
    const input = pairCompleteSchema.parse(await readJson(request, 12_000));
    const admission = await pairAdmission(env).authorizeCompletion(input.pairId, Date.now());
    if (admission.rateLimited) throw new HttpError(429, "Too many pairing attempts");
    if (!admission.admitted) {
      throw new HttpError(401, "Pairing is invalid or expired");
    }
    const watchCredential = await deriveCredential(env.PAIRING_CREDENTIAL_SECRET, "watch", input.pairId);
    const result = await env.PAIR_RELAY.getByName(input.pairId).beginPairing({
      pairId: input.pairId,
      watchPublicKey: input.watchPublicKey,
      fcmInstallationId: input.fcmInstallationId ?? null,
      now: Date.now(),
    });
    return Response.json({ pairId: input.pairId, watchCredential, bridgePublicKey: result.bridgePublicKey });
  }

  const routeMatch = url.pathname.match(/^\/v1\/pairs\/([A-Za-z0-9_-]{43})\/(.+)$/u);
  if (!routeMatch) throw new HttpError(404, "Not found");
  const pairId = routeMatch[1];
  const action = routeMatch[2];
  if (!pairId || !action) throw new HttpError(404, "Not found");
  const credential = bearer(request);
  const role = roleForAction(action);
  if (!role) throw new HttpError(404, "Not found");
  if (!(await secureEqual(credential, await deriveCredential(env.PAIRING_CREDENTIAL_SECRET, role, pairId)))) {
    throw new HttpError(401, "Not authorized");
  }
  const stub = env.PAIR_RELAY.getByName(pairId);

  if (request.method === "GET" && action === "bridge") return stub.fetch(request);
  if (request.method === "GET" && action === "status") return Response.json(await stub.pairingStatus(credential));
  if (request.method === "GET" && action === "watch-status") {
    return Response.json(await stub.watchPairingStatus(credential));
  }
  if (request.method === "POST" && action === "confirm-watch") {
    const input = watchPairingProofSchema.parse(await readJson(request, 4_096));
    await stub.confirmWatch(credential, input.watchProof, Date.now());
    return Response.json({ accepted: true }, { status: 202 });
  }
  if (request.method === "POST" && action === "confirm-bridge") {
    const input = bridgePairingProofSchema.parse(await readJson(request, 8_192));
    await stub.confirmBridge(credential, { ...input, now: Date.now() });
    await pairAdmission(env).release(pairId);
    return Response.json({ paired: true });
  }
  if (request.method === "POST" && action === "to-watch") {
    const envelope = wireEnvelopeSchema.parse(await readJson(request, JSON_LIMIT));
    if (envelope.sender !== "bridge" || envelope.recipient !== "watch") throw new HttpError(400, "Envelope direction is invalid");
    const result = await stub.enqueueToWatch(credential, envelope);
    if (result.fcmInstallationId) await wakeWatch(env, result.fcmInstallationId, pairId);
    return Response.json({ accepted: true, inserted: result.inserted }, { status: 202 });
  }
  if (request.method === "POST" && action === "to-bridge") {
    const envelope = wireEnvelopeSchema.parse(await readJson(request, JSON_LIMIT));
    if (envelope.sender !== "watch" || envelope.recipient !== "bridge") throw new HttpError(400, "Envelope direction is invalid");
    const delivered = await stub.sendToBridge(credential, envelope);
    if (!delivered) throw new HttpError(503, "The bridge is offline");
    return Response.json({ accepted: true }, { status: 202 });
  }
  if (request.method === "GET" && action === "inbox") {
    return Response.json({ messages: await stub.fetchInbox(credential) });
  }
  if (request.method === "POST" && action === "ack") {
    const input = ackSchema.parse(await readJson(request, 12_000));
    return Response.json({ acknowledged: await stub.acknowledge(credential, input.messageIds) });
  }
  if (request.method === "PUT" && action === "registration") {
    const input = registrationSchema.parse(await readJson(request, 8_000));
    await stub.updateFcmRegistration(credential, input.fcmInstallationId);
    return Response.json({ updated: true });
  }
  throw new HttpError(404, "Not found");
}

function roleForAction(action: string): "bridge" | "watch" | null {
  if (["bridge", "status", "confirm-bridge", "to-watch"].includes(action)) return "bridge";
  if (["watch-status", "confirm-watch", "to-bridge", "inbox", "ack", "registration"].includes(action)) {
    return "watch";
  }
  return null;
}

async function requireBootstrap(request: Request, env: Env): Promise<void> {
  if (!(await secureEqual(bearer(request), env.PAIRING_BOOTSTRAP_SECRET))) {
    throw new HttpError(401, "Not authorized");
  }
}

function pairAdmission(env: Env): DurableObjectStub<import("./pair-admission").PairAdmission> {
  return env.PAIR_ADMISSION.getByName("global-v1");
}

async function enforcePairingRateLimits(request: Request, env: Env): Promise<void> {
  const source = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const sourceResult = await env.PAIR_SOURCE_RATE_LIMITER.limit({ key: source });
  if (!sourceResult.success) throw new HttpError(429, "Too many pairing attempts");
  const locationResult = await env.PAIR_LOCATION_RATE_LIMITER.limit({ key: "pair-complete" });
  if (!locationResult.success) throw new HttpError(429, "Too many pairing attempts");
}

async function readJson(request: Request, limit: number): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(length) && length > limit) throw new HttpError(413, "Request is too large");
  if (!request.body) throw new HttpError(400, "JSON body required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel("Request too large");
        throw new HttpError(413, "Request is too large");
      }
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
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function bearer(request: Request): string {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Not authorized");
  const value = header.slice(7);
  if (value.length < 20 || value.length > 256) throw new HttpError(401, "Not authorized");
  return value;
}

function ttl(value: string): number {
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds) || seconds < 60 || seconds > 86_400) throw new Error("Invalid relay TTL configuration");
  return seconds * 1_000;
}

function secureResponse(response: Response): Response {
  // A WebSocket upgrade response carries a runtime-owned `webSocket` handle.
  // Reconstructing it as a normal Response drops that handle (and status 101
  // is not a valid ordinary Response status), turning a successful upgrade
  // into a 500 at the public Worker boundary.
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function log(level: "info" | "error", message: string, data: Record<string, string | number>): void {
  const record = JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...data });
  if (level === "error") console.error(record);
  else console.log(record);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function statusOf(error: unknown): number {
  if (error instanceof ZodError) return 400;
  if (error instanceof PairAdmissionError || error instanceof PairRelayError || error instanceof HttpError) {
    return error.status;
  }
  if (typeof error === "object" && error !== null) {
    const candidate: unknown = Reflect.get(error, "status");
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 400 && candidate <= 599) {
      return candidate;
    }
  }
  return 500;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
