import OpenAI, { toFile } from "openai";
import { MAX_AUDIO_BYTES, MAX_TRANSCRIPT_CHARS } from "./limits.js";

const userAgent = "OpenAI File Downloader, XaiImageApiFetch/1.0";
export type AudioMimeType = "audio/mp4" | "audio/aac";

export interface Transcriber {
  prepare?(): Promise<void>;
  transcribe(audio: Uint8Array, mimeType: AudioMimeType): Promise<string>;
  close?(): void | Promise<void>;
}

export class OpenAITranscriber implements Transcriber {
  private readonly client: OpenAI;

  constructor(apiKey: string, private readonly model = "gpt-transcribe") {
    if (apiKey.length < 20) throw new Error("OPENAI_API_KEY is missing or invalid");
    this.client = new OpenAI({ apiKey, defaultHeaders: { "User-Agent": userAgent } });
  }

  async transcribe(audio: Uint8Array, mimeType: AudioMimeType): Promise<string> {
    if (audio.byteLength < 1_024 || audio.byteLength > MAX_AUDIO_BYTES) {
      throw new Error("Voice recordings must be between 1 KiB and the four-minute limit");
    }
    const file = await toFile(audio, mimeType === "audio/aac" ? "watch-prompt.aac" : "watch-prompt.m4a", { type: mimeType });
    const response = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      response_format: "json",
    });
    const text = response.text.trim();
    if (!text) throw new Error("The recording did not contain recognizable speech");
    return text.slice(0, MAX_TRANSCRIPT_CHARS);
  }
}
