import { describe, expect, it } from "vitest";
import { MAX_CIPHERTEXT_BASE64_CHARS } from "../src/limits";
import { wireEnvelopeSchema } from "../src/schemas";

const envelope = {
  version: 1,
  messageId: "message-1",
  sender: "watch",
  recipient: "bridge",
  sentAt: 1,
  nonce: "AAAAAAAAAAAAAAAA",
};

describe("wire envelope size policy", () => {
  it("accepts the bounded four-minute transcription envelope", () => {
    expect(wireEnvelopeSchema.safeParse({
      ...envelope,
      ciphertext: "A".repeat(MAX_CIPHERTEXT_BASE64_CHARS),
    }).success).toBe(true);
  });

  it("rejects a ciphertext beyond the explicit bound", () => {
    expect(wireEnvelopeSchema.safeParse({
      ...envelope,
      ciphertext: "A".repeat(MAX_CIPHERTEXT_BASE64_CHARS + 4),
    }).success).toBe(false);
  });

  it("accepts an optional boolean wake hint and still rejects unknown fields", () => {
    const base = { ...envelope, ciphertext: "A".repeat(32) };
    expect(wireEnvelopeSchema.safeParse({ ...base, wake: false }).success).toBe(true);
    expect(wireEnvelopeSchema.safeParse({ ...base, wake: true }).success).toBe(true);
    expect(wireEnvelopeSchema.safeParse({ ...base, wake: "false" }).success).toBe(false);
    expect(wireEnvelopeSchema.safeParse({ ...base, other: 1 }).success).toBe(false);
  });
});
