import { env, exports } from "cloudflare:workers";
import { listDurableObjectIds, runInDurableObject } from "cloudflare:test";
import { describe, it } from "vitest";
import { deriveCredential, sha256Base64Url, sha256Hex } from "../src/crypto";
import type { WireEnvelope } from "../src/schemas";

const credentialSecret = "test-credential-secret-that-is-long-enough";
const bridgePublicKey = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";
const watchPublicKey = "WllYV1ZVVFNSUVBPTk1MS0pJSEdGRURDQkE=";
const watchProof = "A".repeat(43);
const bridgeProof = "B".repeat(43);

describe("PairRelay", () => {
  it("completes the mutual-proof handshake through the public API", async ({ expect }) => {
    const pairId = await sha256Base64Url(`route-handshake-${crypto.randomUUID()}`);
    const start = await post("/v1/pair/start", { pairId, bridgePublicKey }, "test-bootstrap-secret-that-is-long-enough");
    expect(start.status).toBe(200);
    const bridgeCredential = requiredString(await responseObject(start), "bridgeCredential");
    const complete = await post("/v1/pair/complete", {
      pairId,
      watchPublicKey,
      fcmInstallationId: "test-installation-id-that-is-long-enough",
    });
    expect(complete.status).toBe(200);
    const watchCredential = requiredString(await responseObject(complete), "watchCredential");
    expect((await post(`/v1/pairs/${pairId}/confirm-watch`, { watchProof }, watchCredential)).status).toBe(202);

    const status = await exports.default.fetch(`https://relay.test/v1/pairs/${pairId}/status`, {
      headers: { Authorization: `Bearer ${bridgeCredential}` },
    });
    expect(await status.json()).toEqual({ paired: false, watchPublicKey, watchProof });
    expect((await post(`/v1/pairs/${pairId}/confirm-bridge`, {
      watchPublicKey,
      watchProof,
      bridgeProof,
    }, bridgeCredential)).status).toBe(200);

    const watchStatus = await exports.default.fetch(`https://relay.test/v1/pairs/${pairId}/watch-status`, {
      headers: { Authorization: `Bearer ${watchCredential}` },
    });
    expect(await watchStatus.json()).toEqual({ paired: true, bridgeProof });
    expect(await env.PAIR_ADMISSION.getByName("global-v1").isIssued(pairId, Date.now())).toBe(false);
  });

  it("pairs without Firebase while leaving push registration empty", async ({ expect }) => {
    const pairId = await sha256Base64Url(`no-firebase-${crypto.randomUUID()}`);
    const start = await post("/v1/pair/start", { pairId, bridgePublicKey }, "test-bootstrap-secret-that-is-long-enough");
    expect(start.status).toBe(200);
    const bridgeCredential = requiredString(await responseObject(start), "bridgeCredential");
    const complete = await post("/v1/pair/complete", { pairId, watchPublicKey });
    expect(complete.status).toBe(200);
    const watchCredential = requiredString(await responseObject(complete), "watchCredential");
    expect((await post(`/v1/pairs/${pairId}/confirm-watch`, { watchProof }, watchCredential)).status).toBe(202);
    expect((await post(`/v1/pairs/${pairId}/confirm-bridge`, {
      watchPublicKey,
      watchProof,
      bridgeProof,
    }, bridgeCredential)).status).toBe(200);

    const result = await env.PAIR_RELAY.getByName(pairId).enqueueToWatch(bridgeCredential, {
      version: 1,
      messageId: "no-firebase-event",
      sender: "bridge",
      recipient: "watch",
      sentAt: Date.now(),
      nonce: "MTIzNDU2Nzg5MDEy",
      ciphertext: "b3BhcXVlLWNpcGhlcnRleHQ=",
    });
    expect(result).toEqual({ fcmInstallationId: null, inserted: true });
  });

  it("preserves the public WebSocket upgrade response", async ({ expect }) => {
    const pairId = await sha256Base64Url(`websocket-upgrade-${crypto.randomUUID()}`);
    const start = await post("/v1/pair/start", { pairId, bridgePublicKey }, "test-bootstrap-secret-that-is-long-enough");
    const bridgeCredential = requiredString(await responseObject(start), "bridgeCredential");

    const response = await exports.default.fetch(`https://relay.test/v1/pairs/${pairId}/bridge`, {
      headers: {
        Authorization: `Bearer ${bridgeCredential}`,
        Upgrade: "websocket",
      },
    });

    expect(response.status).toBe(101);
    expect(response.webSocket).not.toBeNull();
    response.webSocket?.accept();
    response.webSocket?.close(1000, "Test complete");
  });

  it("requires both endpoint proofs before enabling opaque envelope delivery", async ({ expect }) => {
    const pair = await createPendingPair("pair-authenticated-flow");
    const begun = await pair.relay.beginPairing({
      pairId: pair.pairId,
      watchPublicKey,
      fcmInstallationId: "test-installation-id-that-is-long-enough",
      now: Date.now(),
    });
    expect(begun.bridgePublicKey).toBe(bridgePublicKey);

    await pair.relay.confirmWatch(pair.watchCredential, watchProof, Date.now());
    expect(await pair.relay.pairingStatus(pair.bridgeCredential)).toEqual({
      paired: false,
      watchPublicKey,
      watchProof,
    });

    await pair.relay.confirmBridge(pair.bridgeCredential, {
      watchPublicKey,
      watchProof,
      bridgeProof,
      now: Date.now(),
    });
    expect(await pair.relay.watchPairingStatus(pair.watchCredential)).toEqual({ paired: true, bridgeProof });

    const envelope: WireEnvelope = {
      version: 1,
      messageId: "event-1",
      sender: "bridge",
      recipient: "watch",
      sentAt: Date.now(),
      nonce: "MTIzNDU2Nzg5MDEy",
      ciphertext: "b3BhcXVlLWNpcGhlcnRleHQ=",
    };
    expect((await pair.relay.enqueueToWatch(pair.bridgeCredential, envelope)).inserted).toBe(true);
    expect((await pair.relay.enqueueToWatch(pair.bridgeCredential, envelope)).inserted).toBe(false);
    expect(await pair.relay.fetchInbox(pair.watchCredential)).toEqual([envelope]);
    expect(await pair.relay.acknowledge(pair.watchCredential, [envelope.messageId])).toBe(1);
    expect(await pair.relay.fetchInbox(pair.watchCredential)).toEqual([]);
  });

  it("rejects relay-side watch-key and transcript substitution", async ({ expect }) => {
    const pair = await createPendingPair("pair-substitution-rejection");
    await runInDurableObject(pair.relay, async (relay) => {
      await relay.beginPairing({
        pairId: pair.pairId,
        watchPublicKey,
        fcmInstallationId: "test-installation-id-that-is-long-enough",
        now: Date.now(),
      });
      await relay.confirmWatch(pair.watchCredential, watchProof, Date.now());

      await expect(relay.beginPairing({
        pairId: pair.pairId,
        watchPublicKey: bridgePublicKey,
        fcmInstallationId: "second-installation-id-that-is-long-enough",
        now: Date.now(),
      })).rejects.toMatchObject({ status: 409 });
      await expect(relay.confirmWatch(pair.watchCredential, "C".repeat(43), Date.now()))
        .rejects.toMatchObject({ status: 409 });
      await expect(relay.confirmBridge(pair.bridgeCredential, {
        watchPublicKey,
        watchProof: "C".repeat(43),
        bridgeProof,
        now: Date.now(),
      })).rejects.toMatchObject({ status: 409 });
    });
  });

  it("rejects an unissued public pairing guess before pair allocation", async ({ expect }) => {
    const before = (await listDurableObjectIds(env.PAIR_RELAY)).map(String).sort();
    const response = await post("/v1/pair/complete", {
      pairId: await sha256Base64Url(`unissued-${crypto.randomUUID()}`),
      watchPublicKey,
      fcmInstallationId: "test-installation-id-that-is-long-enough",
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Pairing is invalid or expired" });
    expect((await listDurableObjectIds(env.PAIR_RELAY)).map(String).sort()).toEqual(before);
  });

  it("rejects guessed pair routes before pair allocation", async ({ expect }) => {
    const before = (await listDurableObjectIds(env.PAIR_RELAY)).map(String).sort();
    const pairId = await sha256Base64Url(`unknown-route-${crypto.randomUUID()}`);
    const response = await exports.default.fetch(`https://relay.test/v1/pairs/${pairId}/status`, {
      headers: { Authorization: "Bearer invalid-credential-that-is-long-enough" },
    });
    expect(response.status).toBe(401);
    expect((await listDurableObjectIds(env.PAIR_RELAY)).map(String).sort()).toEqual(before);
  });

  it("rate-limits repeated public pairing guesses by edge-verified source", async ({ expect }) => {
    const source = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const statuses: number[] = [];
    for (let index = 0; index < 9; index += 1) {
      statuses.push((await post("/v1/pair/complete", {
        pairId: await sha256Base64Url(`rate-limit-${source}-${index}`),
        watchPublicKey,
        fcmInstallationId: "test-installation-id-that-is-long-enough",
      }, undefined, { "CF-Connecting-IP": source })).status);
    }
    expect(statuses.slice(0, 8)).toEqual(Array(8).fill(401));
    expect(statuses[8]).toBe(429);
  });

  it("reports an offline bridge without persisting watch audio", async ({ expect }) => {
    const pair = await createPendingPair("pair-offline-bridge");
    await pair.relay.beginPairing({
      pairId: pair.pairId,
      watchPublicKey,
      fcmInstallationId: "test-installation-id-that-is-long-enough",
      now: Date.now(),
    });
    await pair.relay.confirmWatch(pair.watchCredential, watchProof, Date.now());
    await pair.relay.confirmBridge(pair.bridgeCredential, {
      watchPublicKey,
      watchProof,
      bridgeProof,
      now: Date.now(),
    });

    expect(await pair.relay.sendToBridge(pair.watchCredential, {
      version: 1,
      messageId: "watch-request-1",
      sender: "watch",
      recipient: "bridge",
      sentAt: Date.now(),
      nonce: "MTIzNDU2Nzg5MDEy",
      ciphertext: "b3BhcXVlLWNpcGhlcnRleHQ=",
    })).toBe(false);
  });

  it("never reinitializes an established pair after its original code deadline", async ({ expect }) => {
    const pair = await createPendingPair("pair-cannot-be-reinitialized");
    await pair.relay.beginPairing({
      pairId: pair.pairId,
      watchPublicKey,
      fcmInstallationId: "test-installation-id-that-is-long-enough",
      now: Date.now(),
    });
    await pair.relay.confirmWatch(pair.watchCredential, watchProof, Date.now());
    await pair.relay.confirmBridge(pair.bridgeCredential, {
      watchPublicKey,
      watchProof,
      bridgeProof,
      now: Date.now(),
    });

    await runInDurableObject(pair.relay, async (relay, state) => {
      state.storage.sql.exec("UPDATE pair_meta SET expires_at = 0");
      expect(await relay.initializePair({
        pairId: pair.pairId,
        bridgePublicKey: "bmV3LWJyaWRnZS1wdWJsaWMta2V5",
        bridgeAuthHash: await sha256Hex("new-bridge-credential-that-is-long-enough"),
        watchAuthHash: await sha256Hex("new-watch-credential-that-is-long-enough"),
        expiresAt: Date.now() + 600_000,
      })).toBe(false);
    });
    expect(await pair.relay.watchPairingStatus(pair.watchCredential)).toEqual({ paired: true, bridgeProof });
  });
});

describe("PairAdmission", () => {
  it("admits only relay-issued unexpired identifiers and releases completed ones", async ({ expect }) => {
    const admission = env.PAIR_ADMISSION.getByName(`test-${crypto.randomUUID()}`);
    const now = Date.now();
    const pairId = "D".repeat(43);
    expect(await admission.isIssued(pairId, now)).toBe(false);
    expect(await admission.reserve(pairId, now + 60_000, now)).toBe(true);
    expect(await admission.reserve(pairId, now + 60_000, now)).toBe(false);
    expect(await admission.isIssued(pairId, now)).toBe(true);
    await admission.release(pairId);
    expect(await admission.isIssued(pairId, now)).toBe(false);
  });

  it("removes expired identifiers before checking admission", async ({ expect }) => {
    const admission = env.PAIR_ADMISSION.getByName(`test-${crypto.randomUUID()}`);
    const now = Date.now();
    const pairId = "E".repeat(43);
    expect(await admission.reserve(pairId, now + 10, now)).toBe(true);
    expect(await admission.isIssued(pairId, now + 11)).toBe(false);
  });

  it("bounds outstanding pairing state", async ({ expect }) => {
    const admission = env.PAIR_ADMISSION.getByName(`test-${crypto.randomUUID()}`);
    await runInDurableObject(admission, async (instance) => {
      const now = Date.now();
      for (const character of ["F", "G", "H"]) {
        expect(await instance.reserve(character.repeat(43), now + 60_000, now)).toBe(true);
      }
      await expect(instance.reserve("J".repeat(43), now + 60_000, now))
        .rejects.toMatchObject({ status: 503 });
    });
  });

  it("enforces an exact relay-wide pairing-attempt budget", async ({ expect }) => {
    const admission = env.PAIR_ADMISSION.getByName(`test-${crypto.randomUUID()}`);
    await runInDurableObject(admission, async (instance) => {
      const now = Date.now();
      for (let index = 0; index < 20; index += 1) {
        expect(await instance.authorizeCompletion(String(index).padStart(43, "K"), now))
          .toEqual({ admitted: false, rateLimited: false });
      }
      expect(await instance.authorizeCompletion("L".repeat(43), now))
        .toEqual({ admitted: false, rateLimited: true });
    });
  });
});

async function createPendingPair(label: string): Promise<{
  pairId: string;
  bridgeCredential: string;
  watchCredential: string;
  relay: DurableObjectStub<import("../src/pair-relay").PairRelay>;
}> {
  const pairId = await sha256Base64Url(label);
  const bridgeCredential = await deriveCredential(credentialSecret, "bridge", pairId);
  const watchCredential = await deriveCredential(credentialSecret, "watch", pairId);
  const relay = env.PAIR_RELAY.getByName(pairId);
  const created = await relay.initializePair({
    pairId,
    bridgePublicKey,
    bridgeAuthHash: await sha256Hex(bridgeCredential),
    watchAuthHash: await sha256Hex(watchCredential),
    expiresAt: Date.now() + 600_000,
  });
  if (!created) throw new Error("Test pair already exists");
  return { pairId, bridgeCredential, watchCredential, relay };
}

async function post(
  path: string,
  body: Record<string, unknown>,
  credential?: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return exports.default.fetch(`https://relay.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function responseObject(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null) throw new Error("Expected an object response");
  return value as Record<string, unknown>;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== "string") throw new Error(`Expected ${key} to be a string`);
  return result;
}
