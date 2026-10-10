import { describe, expect, it } from "vitest";
import { MAX_PUSH_ENVELOPE_CHARS, buildWakeMessage, decideWakeEnvelope, wakeTargetForNewEnvelope } from "../src/fcm";

describe("Firebase wake message", () => {
  it("targets the registered installation with a high-priority data-only wake", () => {
    expect(buildWakeMessage("installation-id", "pair-id")).toEqual({
      message: {
        fid: "installation-id",
        data: { kind: "inbox.ready", pairId: "pair-id" },
        android: { priority: "high", ttl: "60s" },
      },
    });
  });

  it("carries a small envelope as a string in the push data", () => {
    const envelope = { sender: "bridge", recipient: "watch", messageId: "m1", ciphertext: "abc" };
    const message = buildWakeMessage("installation-id", "pair-id", envelope);
    expect(message.message.data.kind).toBe("inbox.ready");
    expect(typeof message.message.data.envelope).toBe("string");
    expect(JSON.parse(message.message.data.envelope as string)).toEqual(envelope);
  });

  it("omits an envelope over the size limit", () => {
    const big = { ciphertext: "x".repeat(MAX_PUSH_ENVELOPE_CHARS) };
    expect(buildWakeMessage("installation-id", "pair-id", big)).toEqual(buildWakeMessage("installation-id", "pair-id"));
    const exact = { c: "x".repeat(MAX_PUSH_ENVELOPE_CHARS - JSON.stringify({ c: "" }).length) };
    expect(JSON.stringify(exact).length).toBe(MAX_PUSH_ENVELOPE_CHARS);
    expect(buildWakeMessage("installation-id", "pair-id", exact).message.data).toHaveProperty("envelope");
  });

  it("wakes only for a newly inserted envelope", () => {
    expect(wakeTargetForNewEnvelope("installation-id", true)).toBe("installation-id");
    expect(wakeTargetForNewEnvelope("installation-id", false)).toBeNull();
    expect(wakeTargetForNewEnvelope(null, true)).toBeNull();
  });

  it("decides envelope attachment as a pure function with its length", () => {
    expect(decideWakeEnvelope()).toEqual({ envelopeAttached: false, envelopeChars: 0, serialized: null });
    const small = { a: "b" };
    expect(decideWakeEnvelope(small)).toEqual({ envelopeAttached: true, envelopeChars: JSON.stringify(small).length, serialized: JSON.stringify(small) });
    const big = { c: "x".repeat(MAX_PUSH_ENVELOPE_CHARS) };
    expect(decideWakeEnvelope(big)).toEqual({ envelopeAttached: false, envelopeChars: 0, serialized: null });
    expect(decideWakeEnvelope(() => 1)).toMatchObject({ envelopeAttached: false, envelopeChars: 0 });
  });
});
