import { bytesToBase64Url } from "./crypto";

const encoder = new TextEncoder();
const downloaderUserAgent = "OpenAI File Downloader, XaiImageApiFetch/1.0";

type OAuthResponse = { access_token?: unknown };
type CachedAccessToken = { token: string; projectId: string; clientEmail: string; expiresAt: number };

let cachedAccessToken: CachedAccessToken | null = null;

export const MAX_PUSH_ENVELOPE_CHARS = 3_000;

export type WakeDiagnostics = { envelopeAttached: boolean; envelopeChars: number };

/** Carries metadata-only diagnostics when the FCM send fails. */
export type WakeStage = "oauth" | "fcm" | "network";

export class WakeFailure extends Error {
  constructor(
    message: string,
    readonly diagnostics: WakeDiagnostics | null,
    readonly stage: WakeStage = "network",
    readonly httpStatus: number = 0,
    readonly fcmErrorCode: string | null = null,
  ) { super(message); }
}

/** Internal carrier of non-sensitive stage details; never holds remote text. */
class StageError extends Error {
  constructor(readonly stage: WakeStage, readonly httpStatus: number, readonly code: string | null) { super("wake stage failed"); }
}

const OAUTH_CODE = /^[a-z_]{1,40}$/u;
const FCM_CODE = /^[A-Z_]{1,40}$/u;

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch { return null; }
}

async function readBoundedOrEmpty(response: Response): Promise<string> {
  try { return await drainBounded(response, 16_384); } catch { return ""; }
}

export function extractOAuthErrorCode(body: string): string | null {
  const code = parseJsonObject(body)?.error;
  return typeof code === "string" && OAUTH_CODE.test(code) ? code : null;
}

export function extractFcmErrorCode(body: string): string | null {
  const error = parseJsonObject(body)?.error;
  if (typeof error !== "object" || error === null) return null;
  const { details, status } = error as { details?: unknown; status?: unknown };
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (typeof detail !== "object" || detail === null) continue;
      const { "@type": type, errorCode } = detail as Record<string, unknown>;
      if (typeof type === "string" && type.endsWith("FcmError") && typeof errorCode === "string" && FCM_CODE.test(errorCode)) return errorCode;
    }
  }
  return typeof status === "string" && FCM_CODE.test(status) ? status : null;
}

/** Pure decision: attach the envelope only when it serializes within the push size limit. */
export function decideWakeEnvelope(envelope?: unknown): WakeDiagnostics & { serialized: string | null } {
  if (envelope === undefined) return { envelopeAttached: false, envelopeChars: 0, serialized: null };
  const serialized = JSON.stringify(envelope);
  if (typeof serialized === "string" && serialized.length <= MAX_PUSH_ENVELOPE_CHARS) {
    return { envelopeAttached: true, envelopeChars: serialized.length, serialized };
  }
  return { envelopeAttached: false, envelopeChars: 0, serialized: null };
}

export async function wakeWatch(env: Env, installationId: string, pairId: string, envelope?: unknown): Promise<WakeDiagnostics> {
  const { envelopeAttached, envelopeChars } = decideWakeEnvelope(envelope);
  const diagnostics = { envelopeAttached, envelopeChars };
  try {
    await sendWake(env, installationId, pairId, envelope);
  } catch (error) {
    // Never carry the original error text: it could include remote response content.
    if (error instanceof StageError) throw new WakeFailure("FCM wake failed", diagnostics, error.stage, error.httpStatus, error.code);
    throw new WakeFailure("FCM wake failed", diagnostics, "network", 0, null);
  }
  return diagnostics;
}

async function sendWake(env: Env, installationId: string, pairId: string, envelope?: unknown): Promise<void> {
  const accessToken = await createAccessToken(env);
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": downloaderUserAgent,
      },
      body: JSON.stringify(buildWakeMessage(installationId, pairId, envelope)),
    },
  );
  if (!response.ok) throw new StageError("fcm", response.status, extractFcmErrorCode(await readBoundedOrEmpty(response)));
  await drainBounded(response, 16_384);
}

export function wakeTargetForNewEnvelope(installationId: string | null, inserted: boolean): string | null {
  return inserted && installationId ? installationId : null;
}

export function buildWakeMessage(installationId: string, pairId: string, envelope?: unknown) {
  const data: Record<string, string> = { kind: "inbox.ready", pairId };
  const decision = decideWakeEnvelope(envelope);
  if (decision.serialized !== null) data.envelope = decision.serialized;
  return {
    message: {
      fid: installationId,
      data,
      android: { priority: "high", ttl: "60s" },
    },
  } as const;
}

async function createAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  if (
    cachedAccessToken &&
    cachedAccessToken.projectId === env.FIREBASE_PROJECT_ID &&
    cachedAccessToken.clientEmail === env.FIREBASE_CLIENT_EMAIL &&
    cachedAccessToken.expiresAt - 300 > now
  ) return cachedAccessToken.token;
  const encodedHeader = encodeJson({ alg: "RS256", typ: "JWT" });
  const encodedClaims = encodeJson({
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3_600,
  });
  const unsigned = `${encodedHeader}.${encodedClaims}`;
  let assertion: string;
  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemBytes(env.FIREBASE_PRIVATE_KEY),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
    assertion = `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
  } catch {
    throw new StageError("oauth", 0, null);
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": downloaderUserAgent,
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new StageError("oauth", response.status, extractOAuthErrorCode(await readBoundedOrEmpty(response)));
  const parsed: OAuthResponse = parseJsonObject(await readBoundedOrEmpty(response)) ?? {};
  if (typeof parsed.access_token !== "string" || parsed.access_token.length < 20) {
    throw new StageError("oauth", 0, null);
  }
  cachedAccessToken = {
    token: parsed.access_token,
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    expiresAt: now + 3_600,
  };
  return parsed.access_token;
}

function encodeJson(value: Record<string, string | number>): string {
  return bytesToBase64Url(encoder.encode(JSON.stringify(value)));
}

function pemBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("\\n", "\n");
  const base64 = normalized.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/gu, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function drainBounded(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error("Remote response exceeded the allowed size");
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
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
}
