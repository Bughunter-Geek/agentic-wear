import { bytesToBase64Url } from "./crypto";

const encoder = new TextEncoder();
const downloaderUserAgent = "OpenAI File Downloader, XaiImageApiFetch/1.0";

type OAuthResponse = { access_token?: unknown };
type CachedAccessToken = { token: string; projectId: string; clientEmail: string; expiresAt: number };

let cachedAccessToken: CachedAccessToken | null = null;

export async function wakeWatch(env: Env, installationId: string, pairId: string): Promise<void> {
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
      body: JSON.stringify(buildWakeMessage(installationId, pairId)),
    },
  );
  if (!response.ok) throw new Error(`FCM wake failed with status ${response.status}`);
  await drainBounded(response, 16_384);
}

export function buildWakeMessage(installationId: string, pairId: string) {
  return {
    message: {
      fid: installationId,
      data: { kind: "inbox.ready", pairId },
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
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(env.FIREBASE_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const assertion = `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
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
  if (!response.ok) throw new Error(`Firebase authentication failed with status ${response.status}`);
  const parsed: OAuthResponse = JSON.parse(await drainBounded(response, 16_384));
  if (typeof parsed.access_token !== "string" || parsed.access_token.length < 20) {
    throw new Error("Firebase authentication returned no access token");
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
