import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { CryptoBox, generateBridgeKeyPair } from "../src/crypto-box.js";
import { TurnReceipts } from "../src/turn-receipts.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "watch-receipts-"));
  const bridge = await generateBridgeKeyPair();
  const watch = await generateBridgeKeyPair();
  const crypto = new CryptoBox("test-pair", bridge.privateKeyMaterial, bridge.publicKeyBase64, watch.publicKeyBase64);
  return { directory, crypto, ledger: new TurnReceipts(directory, crypto) };
}

describe("durable Watch turn receipts", () => {
  it("replays the original acknowledgment after restart without exposing prompt plaintext", async () => {
    const { directory, crypto, ledger } = await fixture();
    try {
      const request = { requestId: "request-1", text: "Private example text", threadId: null };
      const response = { version: 1, kind: "turn.accepted", threadId: "new-thread" };
      expect(await ledger.begin("request-1", request)).toBeNull();
      await ledger.finish("request-1", response);
      expect((await new TurnReceipts(directory, crypto).begin("request-1", request))?.response).toEqual(response);
      for (const file of await readdir(directory)) {
        expect(await readFile(join(directory, file), "utf8")).not.toContain("Private example text");
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("never redispatches a new-chat prompt after a crash between dispatch and acknowledgment", async () => {
    const { directory, crypto, ledger } = await fixture();
    try {
      const request = { threadId: null, text: "Once" };
      expect(await ledger.begin("request-2", request)).toBeNull();
      expect(await new TurnReceipts(directory, crypto).begin("request-2", request)).toMatchObject({ response: null });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("does not turn a transport error after acceptance into a rejected prompt", async () => {
    const { directory, ledger } = await fixture();
    try {
      await ledger.begin("request-3", { text: "Once" });
      const accepted = { kind: "turn.accepted", threadId: "thread-3", state: "running" };
      await ledger.finish("request-3", accepted);
      expect(await ledger.finish("request-3", { kind: "turn.error", deliveryUncertain: true }, false, true)).toEqual(accepted);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("allows legacy non-turn error delivery without a turn receipt", async () => {
    const { directory, ledger } = await fixture();
    try {
      const response = { kind: "turn.error", requestId: "session-sync", message: "Session sync failed" };
      expect(await ledger.finish("session-sync", response)).toEqual(response);
      expect(await readdir(directory)).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("reports uncertainty for an interrupted empty receipt without dispatching again", async () => {
    const { directory, ledger } = await fixture();
    try {
      const request = { text: "Once" };
      await ledger.begin("empty-receipt", request);
      const [file] = await readdir(directory);
      await writeFile(join(directory, file!), "");
      expect(await ledger.get("empty-receipt", request)).toMatchObject({ response: null });
      const uncertain = { kind: "turn.error", deliveryUncertain: true };
      expect(await ledger.finish("empty-receipt", uncertain, false)).toEqual(uncertain);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("replaces a waiting receipt with the final rejected selection and recovered draft", async () => {
    const { directory, ledger } = await fixture();
    try {
      await ledger.begin("waiting", { text: "Draft" });
      await ledger.finish("waiting", { kind: "turn.accepted", state: "waiting" });
      const failed = { kind: "turn.error", deferred: true, draftText: "Draft" };
      expect(await ledger.finish("waiting", failed, true, true)).toEqual(failed);
      expect((await ledger.get("waiting", { text: "Draft" }))?.response).toEqual(failed);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects reuse of a request UUID for a different prompt", async () => {
    const { directory, ledger } = await fixture();
    try {
      await ledger.begin("request-4", { text: "First" });
      await expect(ledger.begin("request-4", { text: "Different" })).rejects.toThrow("different content");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
