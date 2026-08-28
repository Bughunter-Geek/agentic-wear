import { describe, expect, it } from "vitest";
import { MAX_AUDIO_BASE64_CHARS, MAX_TRANSCRIPT_CHARS } from "../src/limits.js";
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

  it("accepts a bounded four-minute recording envelope", () => {
    expect(watchPayloadSchema.safeParse({
      ...transcription,
      mimeType: "audio/aac",
      audioBase64: "A".repeat(MAX_AUDIO_BASE64_CHARS),
    }).success).toBe(true);
  });

  it("rejects audio beyond the four-minute transport bound", () => {
    expect(watchPayloadSchema.safeParse({
      ...transcription,
      mimeType: "audio/aac",
      audioBase64: "A".repeat(MAX_AUDIO_BASE64_CHARS + 4),
    }).success).toBe(false);
  });

  it("accepts an editable long-form prompt and rejects anything larger", () => {
    const prompt = {
      version: 1,
      kind: "turn.submit",
      requestId: "request-2",
      threadId: null,
    };
    expect(watchPayloadSchema.safeParse({ ...prompt, text: "x".repeat(MAX_TRANSCRIPT_CHARS) }).success).toBe(true);
    expect(watchPayloadSchema.safeParse({ ...prompt, text: "x".repeat(MAX_TRANSCRIPT_CHARS + 1) }).success).toBe(false);
  });

  it("accepts a bridge-advertised model and reasoning effort", () => {
    const payload = {
      version: 1,
      kind: "turn.submit",
      requestId: "request-3",
      threadId: null,
      text: "Use the selected settings.",
      model: "gpt-5.6-terra",
      effort: "xhigh",
    };
    expect(watchPayloadSchema.parse(payload)).toMatchObject({ model: "gpt-5.6-terra", effort: "xhigh" });
  });

  it("defaults effort for older watch payloads", () => {
    const payload = {
      version: 1,
      kind: "turn.submit",
      requestId: "request-4",
      threadId: null,
      text: "Keep the legacy wire shape working.",
    };
    expect(watchPayloadSchema.parse(payload)).toMatchObject({ effort: "medium" });
  });

  it("bounds the previous draft used for semantic revision", () => {
    const payload = { ...transcription, mimeType: "audio/aac" };
    expect(watchPayloadSchema.safeParse({ ...payload, previousText: "Keep the cyan border" }).success).toBe(true);
    expect(watchPayloadSchema.safeParse({ ...payload, previousText: "x".repeat(MAX_TRANSCRIPT_CHARS) }).success).toBe(true);
    expect(watchPayloadSchema.safeParse({ ...payload, previousText: "x".repeat(MAX_TRANSCRIPT_CHARS + 1) }).success).toBe(false);
  });
});
