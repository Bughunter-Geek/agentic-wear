import { describe, expect, it } from "vitest";
import { watchPayloadSchema } from "../src/schemas.js";

const transcription = {
  version: 1,
  kind: "transcription.create",
  requestId: "request-1",
  audioBase64: "A".repeat(32),
  threadId: null,
};

describe("watch transcription audio formats", () => {
  it.each(["audio/mp4", "audio/aac"])("accepts %s", (mimeType) => {
    expect(watchPayloadSchema.safeParse({ ...transcription, mimeType }).success).toBe(true);
  });

  it("rejects undeclared formats", () => {
    expect(watchPayloadSchema.safeParse({ ...transcription, mimeType: "audio/wav" }).success).toBe(false);
  });
});
