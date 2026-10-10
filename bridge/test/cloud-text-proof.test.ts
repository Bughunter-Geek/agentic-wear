import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CloudTextProof, CLOUD_PROOF, CLOUD_PROOF_PROMPT_SHA } from "../src/cloud-text-proof.js";
import { verifiedReply } from "../src/cloud-text-proof-control.js";
import { BridgeService } from "../src/bridge-service.js";

async function fixture() {
  const parent = join(process.cwd(), ".proof-test-runs");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-"));
  const now = Date.now();
  const proof = new CloudTextProof(root, () => now);
  const identity = { proofId: CLOUD_PROOF.id, threadId: CLOUD_PROOF.threadId, hostId: CLOUD_PROOF.hostId };
  await proof.writeOnce("approval.json", { ...identity, enabled: true, activatedAt: now - 100, expiresAt: now + 60_000 });
  return { root, now, proof, identity };
}

function nativeReply(now: number) {
  return { thread: { id: CLOUD_PROOF.threadId, hostId: CLOUD_PROOF.hostId, kind: "codex" },
    turns: [{ id: "native-new-turn", status: "completed", completedAt: now + 1000,
      items: [{ type: "agentMessage", id: "native-final", phase: "final_answer", text: CLOUD_PROOF.acknowledgement }] }] };
}

describe("supervised native cloud Watch proof", () => {
  it("only enables the exact target, bounds the prompt and persists one Watch claim across restart", async () => {
    const { root, proof } = await fixture();
    expect((await proof.session())?.id).toBe(CLOUD_PROOF.threadId);
    expect(proof.owns("different-task")).toBe(false);
    await expect(proof.enqueue("watch-bad", "do unrelated work")).rejects.toThrow("accepts only");
    const original = await proof.enqueue("watch-uuid", CLOUD_PROOF.watchText);
    const restarted = new CloudTextProof(root);
    expect(await restarted.enqueue("watch-uuid", CLOUD_PROOF.watchText)).toEqual(original);
    await expect(restarted.enqueue("watch-second", CLOUD_PROOF.watchText)).rejects.toThrow("single Watch message");
    expect((await restarted.snapshot()).messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("revocation and expiry stop new input and reply publication without deleting records", async () => {
    const { root, now, proof } = await fixture();
    await proof.enqueue("watch-uuid", CLOUD_PROOF.watchText);
    await proof.writeOnce("disabled.json", { disabledAt: now });
    expect(await proof.session()).toBeNull();
    await expect(proof.enqueue("watch-second", CLOUD_PROOF.watchText)).rejects.toThrow("not active");
    const deliver = vi.fn();
    await proof.publish(deliver, true);
    expect(deliver).not.toHaveBeenCalled();
    expect(await proof.readJson("request.json")).not.toBeNull();
    const expired = new CloudTextProof(root, () => now + 100_000);
    expect(await expired.approval()).toBeNull();
  });

  it("rejects old, unfinished, commentary, wrong-host and pre-request native replies", () => {
    const now = Date.now();
    const actual = nativeReply(now);
    expect(verifiedReply(actual, [], now).nativeItemId).toBe("native-final");
    expect(() => verifiedReply(actual, ["native-new-turn"], now)).toThrow("No new completed");
    expect(() => verifiedReply({ ...actual, thread: { ...actual.thread, hostId: "local" } }, [], now)).toThrow();
    expect(() => verifiedReply({ ...actual, turns: [{ ...actual.turns[0]!, status: "inProgress" }] }, [], now)).toThrow();
    expect(() => verifiedReply({ ...actual, turns: [{ ...actual.turns[0]!, completedAt: now - 1000 }] }, [], now)).toThrow();
    expect(() => verifiedReply({ ...actual, turns: [{ ...actual.turns[0]!, items: [{ ...actual.turns[0]!.items[0]!, phase: "commentary" }] }] }, [], now)).toThrow();
  });

  it("requires native acceptance and matching correlation before returning the observed reply", async () => {
    const { proof, now, identity } = await fixture();
    await proof.enqueue("watch-uuid", CLOUD_PROOF.watchText);
    await proof.writeOnce("reply.json", { ...identity, requestId: "watch-uuid", promptSha256: CLOUD_PROOF_PROMPT_SHA,
      nativeTurnId: "native-turn", nativeItemId: "native-item", reply: CLOUD_PROOF.acknowledgement, observedAt: now });
    await expect(proof.snapshot()).rejects.toThrow("does not match");
    await proof.writeOnce("accepted.json", { ...identity, requestId: "watch-uuid", acceptedAt: now });
    const sent: Array<Record<string, unknown>> = [];
    await proof.publish(async (value) => { sent.push(value); }, true);
    expect(sent.map((value) => value.kind)).toEqual(["turn.started", "chat.snapshot", "terminal.completed"]);
    expect((await proof.snapshot()).messages[1]).toMatchObject({ role: "assistant", id: "native-item", turnId: "native-turn", text: CLOUD_PROOF.acknowledgement });
    await proof.publish(async (value) => { sent.push(value); }, true);
    expect(sent).toHaveLength(3);
    expect(await proof.readJson("delivery.json")).toMatchObject({ requestId: "watch-uuid", nativeItemId: "native-item",
      snapshotIncluded: true, watchReceiptVerified: false });
  });

  it("does not record relay acceptance if reply delivery fails", async () => {
    const { proof, now, identity } = await fixture();
    await proof.enqueue("watch-uuid", CLOUD_PROOF.watchText);
    await proof.writeOnce("accepted.json", { ...identity, requestId: "watch-uuid", acceptedAt: now });
    await proof.writeOnce("reply.json", { ...identity, requestId: "watch-uuid", promptSha256: CLOUD_PROOF_PROMPT_SHA,
      nativeTurnId: "native-turn", nativeItemId: "native-item", reply: CLOUD_PROOF.acknowledgement, observedAt: now });
    await expect(proof.publish(async (value) => {
      if (value.kind === "terminal.completed") throw new Error("Relay unavailable");
    }, false)).rejects.toThrow("Relay unavailable");
    expect(await proof.readJson("delivery.json")).toBeNull();
    await proof.publish(async () => undefined, false);
    expect(await proof.readJson("delivery.json")).toMatchObject({ snapshotIncluded: false, watchReceiptVerified: false });
  });

  it("intercepts the cloud target before local submission and never applies Watch model overrides", async () => {
    const { proof } = await fixture();
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    const submitTurn = vi.fn();
    const send = vi.fn().mockResolvedValue(undefined);
    Object.assign(service, { cloudTextProof: proof, appServer: { submitTurn }, send, sendChatSnapshot: vi.fn().mockResolvedValue(undefined) });
    await (service.handleWatchPayload as (payload: unknown) => Promise<void>).call(service, {
      version: 1, kind: "turn.submit", requestId: "watch-cloud", threadId: CLOUD_PROOF.threadId,
      text: CLOUD_PROOF.watchText, model: "different-model", effort: "low", fastMode: false,
    });
    expect(submitTurn).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "turn.accepted", state: "waiting", selectionApplied: false }));
    const request = await proof.readJson("request.json");
    expect(request).not.toHaveProperty("model");
    expect(request).not.toHaveProperty("effort");
    expect(request).not.toHaveProperty("fastMode");
  });

  it("never puts a cloud request in the local retry worker after a transient error", async () => {
    const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
    const storePendingTurn = vi.fn();
    const send = vi.fn().mockResolvedValue(undefined);
    Object.assign(service, { cloudTextProof: { owns: () => true, enqueue: vi.fn().mockRejectedValue(new Error("temporarily unavailable")) },
      storePendingTurn, send, sendSessions: vi.fn().mockResolvedValue(undefined) });
    await (service.handleWatchPayload as (payload: unknown) => Promise<void>).call(service, {
      version: 1, kind: "turn.submit", requestId: "watch-cloud", threadId: CLOUD_PROOF.threadId, text: CLOUD_PROOF.watchText,
    });
    expect(storePendingTurn).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "turn.error", requestId: "watch-cloud" }));
  });

  it("refuses symlinked response files instead of reading an unrelated file", async () => {
    const { root, proof } = await fixture();
    const { symlink } = await import("node:fs/promises");
    const other = join(root, "unrelated.json");
    await writeFile(other, "{}", { mode: 0o600 });
    await symlink(other, join(root, "reply.json"));
    await expect(proof.readJson("reply.json")).rejects.toThrow();
  });
});
