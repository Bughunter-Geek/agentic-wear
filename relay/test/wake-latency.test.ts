import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { acknowledgeStoredEnvelope } from "../src/index";
import { wakeTargetForNewEnvelope } from "../src/fcm";
import { deriveCredential, sha256Base64Url, sha256Hex } from "../src/crypto";

function heldWake() {
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => { finish = resolve; });
  const pending: Promise<unknown>[] = [];
  return { finish, blocked, pending, ctx: { waitUntil: (p: Promise<unknown>) => { pending.push(p); } } };
}

describe("stored result ACK without Firebase queue delay", () => {
  it("returns accepted while wake remains pending and retains its lifetime", async () => {
    const h = heldWake();
    const wake = vi.fn(() => h.blocked);
    const response = acknowledgeStoredEnvelope(true, h.ctx, wake);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, inserted: true });
    expect(h.pending).toHaveLength(1);
    await Promise.resolve();
    expect(wake).toHaveBeenCalledTimes(1);
    h.finish();
    await Promise.all(h.pending);
  });

  it("does not wake duplicated envelopes or absent installations", () => {
    const h = heldWake();
    expect(wakeTargetForNewEnvelope("synthetic-installation-id", false)).toBeNull();
    expect(wakeTargetForNewEnvelope(null, true)).toBeNull();
    expect(wakeTargetForNewEnvelope("synthetic-installation-id", true)).toBe("synthetic-installation-id");
    expect(acknowledgeStoredEnvelope(false, h.ctx).status).toBe(202);
    expect(h.pending).toHaveLength(0);
  });

  it("keeps a failed wake from turning durable delivery into a failed request", async () => {
    const h = heldWake();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = acknowledgeStoredEnvelope(true, h.ctx, async () => { throw new Error("synthetic-secret-must-not-be-logged"); });
      expect(response.status).toBe(202);
      await expect(Promise.all(h.pending)).resolves.toEqual([undefined]);
      expect(JSON.stringify([...log.mock.calls, ...errorLog.mock.calls])).not.toContain("synthetic-secret-must-not-be-logged");
    } finally { log.mockRestore(); errorLog.mockRestore(); }
  });

  it("allows the next serial bridge operation to advance before the previous wake finishes", async () => {
    const h = heldWake();
    let nextStarted = false;
    await Promise.resolve().then(() => acknowledgeStoredEnvelope(true, h.ctx, () => h.blocked)).then(() => { nextStarted = true; });
    expect(nextStarted).toBe(true);
    expect(h.pending).toHaveLength(1);
    h.finish();
    await Promise.all(h.pending);
  });

  it("measures matched synthetic ACK boundaries including the slower wake tail", async () => {
    const rows = [];
    for (const wakeMs of [600, 1200, 2700]) {
      const wake = () => new Promise<void>((resolve) => setTimeout(resolve, wakeMs));
      let started = Date.now();
      await wake(); // Previous production path: await wake before returning HTTP 202.
      const beforeAckMs = Date.now() - started;
      const pending: Promise<unknown>[] = [];
      started = Date.now();
      const response = acknowledgeStoredEnvelope(true, { waitUntil: (p) => { pending.push(p); } }, wake);
      const afterAckMs = Date.now() - started;
      expect(response.status).toBe(202);
      expect(beforeAckMs).toBeGreaterThanOrEqual(wakeMs - 20);
      expect(afterAckMs).toBeLessThan(100);
      await Promise.all(pending);
      rows.push({ wakeMs, beforeAckMs, afterAckMs });
    }
    console.log(JSON.stringify({ message: "synthetic.wake-ack.benchmark", watchEndToEndMeasured: false, rows }));
  }, 15000);

  it("persists an authenticated result despite wake failure, deduplicates retries, and retains watch-only inbox access", async () => {
    const id = await sha256Base64Url(crypto.randomUUID());
    const secret = "test-credential-secret-that-is-long-enough";
    const bridge = await deriveCredential(secret, "bridge", id);
    const watch = await deriveCredential(secret, "watch", id);
    const relay = env.PAIR_RELAY.getByName(id);
    await relay.initializePair({ pairId: id, bridgePublicKey: "A".repeat(44), bridgeAuthHash: await sha256Hex(bridge), watchAuthHash: await sha256Hex(watch), expiresAt: Date.now() + 60000 });
    await relay.beginPairing({ pairId: id, watchPublicKey: "B".repeat(44), fcmInstallationId: "synthetic-installation-id", now: Date.now() });
    await relay.confirmWatch(watch, "C".repeat(43), Date.now());
    await relay.confirmBridge(bridge, { watchPublicKey: "B".repeat(44), watchProof: "C".repeat(43), bridgeProof: "D".repeat(43), now: Date.now() });
    const envelope = { version: 1, messageId: "synthetic-result", sender: "bridge", recipient: "watch", sentAt: Date.now(), nonce: "MTIzNDU2Nzg5MDEy", ciphertext: "b3BhcXVlLWNpcGhlcnRleHQ=" };
    const url = `https://relay.test/v1/pairs/${id}`;
    const post = (credential: string) => exports.default.fetch(`${url}/to-watch`, { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify(envelope) });
    expect((await post(watch)).status).toBe(401);
    const delivered = await post(bridge);
    expect(delivered.status).toBe(202);
    expect(await delivered.json()).toEqual({ accepted: true, inserted: true });
    expect(await (await post(bridge)).json()).toEqual({ accepted: true, inserted: false });
    expect((await exports.default.fetch(`${url}/inbox`)).status).toBe(401);
    expect((await exports.default.fetch(`${url}/inbox`, { headers: { Authorization: `Bearer ${bridge}` } })).status).toBe(401);
    expect(await (await exports.default.fetch(`${url}/inbox`, { headers: { Authorization: `Bearer ${watch}` } })).json()).toEqual({ messages: [envelope] });
  });
});
