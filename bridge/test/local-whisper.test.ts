import { describe, expect, it } from "vitest";
import { MAX_AUDIO_BYTES } from "../src/limits.js";
import { isSupportedAudioMimeType, LocalWhisperTranscriber, resolveTranscriptionProvider } from "../src/local-whisper.js";

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

  it("rejects recordings beyond the bounded four-minute payload before starting the worker", async () => {
    const transcriber = new LocalWhisperTranscriber("/missing/python", "/missing/ffmpeg");
    await expect(transcriber.transcribe(new Uint8Array(MAX_AUDIO_BYTES + 1), "audio/aac"))
      .rejects.toThrow(/four-minute/u);
  });

  it("accepts both legacy MP4 and frame-safe AAC recordings", () => {
    expect(isSupportedAudioMimeType("audio/mp4")).toBe(true);
    expect(isSupportedAudioMimeType("audio/aac")).toBe(true);
    expect(isSupportedAudioMimeType("audio/wav")).toBe(false);
  });
});
