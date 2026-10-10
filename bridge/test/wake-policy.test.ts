import { describe, expect, it } from "vitest";
import { shouldWakeWatch } from "../src/wake-policy.js";
import { wireEnvelopeSchema } from "../src/schemas.js";

describe("shouldWakeWatch", () => {
  it("keeps bulk snapshots quiet", () => {
    expect(shouldWakeWatch("chat.snapshot")).toBe(false);
    expect(shouldWakeWatch("sessions.snapshot")).toBe(false);
  });
  it("wakes for everything else", () => {
    for (const kind of ["terminal.completed", "approval.request", "live.answer", "turn.accepted", "chat.error", "transcription.result", undefined]) {
      expect(shouldWakeWatch(kind)).toBe(true);
    }
  });
  it("envelope schema accepts the optional wake boolean and still rejects unknown keys", () => {
    const base = { version: 1, messageId: "m1", sender: "bridge", recipient: "watch", sentAt: 1,
      nonce: "AAAAAAAAAAAAAAAA", ciphertext: "AAAAAAAAAAAAAAAAAAAA" };
    expect(wireEnvelopeSchema.safeParse(base).success).toBe(true);
    expect(wireEnvelopeSchema.safeParse({ ...base, wake: false }).success).toBe(true);
    expect(wireEnvelopeSchema.safeParse({ ...base, wake: "no" }).success).toBe(false);
    expect(wireEnvelopeSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});
