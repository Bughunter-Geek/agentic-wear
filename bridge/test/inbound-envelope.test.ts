import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { processAuthenticatedEnvelope } from "../src/inbound-envelope.js";
import { ReplayGuard } from "../src/replay-guard.js";
import type { WireEnvelope } from "../src/schemas.js";

describe("processAuthenticatedEnvelope", () => {
  it("claims only after authenticated payload validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentic-wear-inbound-"));
    try {
      const envelope = testEnvelope("validation-order");
      const guard = new ReplayGuard(root);
      await expect(processAuthenticatedEnvelope(
        envelope,
        { decrypt: () => Promise.resolve({ version: 1, kind: "not-a-command" }) },
        guard,
        () => Promise.resolve(),
      )).rejects.toThrow();

      let handled = 0;
      expect(await processAuthenticatedEnvelope(
        envelope,
        { decrypt: () => Promise.resolve({ version: 1, kind: "session.sync", requestId: "request-1" }) },
        guard,
        () => {
          handled += 1;
          return Promise.resolve();
        },
      )).toBe(true);
      expect(handled).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the claim when a downstream side effect partially succeeds", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentic-wear-inbound-"));
    try {
      const envelope = testEnvelope("partial-side-effect");
      const crypto = { decrypt: () => Promise.resolve({ version: 1, kind: "session.sync", requestId: "request-2" }) };
      let sideEffects = 0;
      await expect(processAuthenticatedEnvelope(envelope, crypto, new ReplayGuard(root), () => {
        sideEffects += 1;
        return Promise.reject(new Error("delivery failed after side effect"));
      })).rejects.toThrow("delivery failed after side effect");

      expect(await processAuthenticatedEnvelope(envelope, crypto, new ReplayGuard(root), () => {
        sideEffects += 1;
        return Promise.resolve();
      })).toBe(false);
      expect(sideEffects).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function testEnvelope(messageId: string): WireEnvelope {
  return {
    version: 1,
    messageId,
    sender: "watch",
    recipient: "bridge",
    sentAt: Date.now(),
    nonce: "MTIzNDU2Nzg5MDEy",
    ciphertext: "b3BhcXVlLWNpcGhlcnRleHQ=",
  };
}
