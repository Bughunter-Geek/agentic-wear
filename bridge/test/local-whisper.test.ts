import { describe, expect, it } from "vitest";
import { LocalWhisperTranscriber, resolveTranscriptionProvider } from "../src/local-whisper.js";

describe("local transcription policy", () => {
  it("defaults to local Whisper without an API setting", () => {
    expect(resolveTranscriptionProvider(undefined)).toBe("local");
  });

  it("keeps paid OpenAI transcription as an explicit opt-in", () => {
    expect(resolveTranscriptionProvider("openai")).toBe("openai");
    expect(() => resolveTranscriptionProvider("automatic")).toThrow(/local.*openai/u);
  });

  it("rejects malformed audio before starting the local worker", async () => {
    const transcriber = new LocalWhisperTranscriber("/missing/python", "/missing/ffmpeg");
    await expect(transcriber.transcribe(new Uint8Array(12), "audio/mp4")).rejects.toThrow(/1 KiB/u);
  });
});
