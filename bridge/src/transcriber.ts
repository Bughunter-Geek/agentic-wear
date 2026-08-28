import OpenAI, { toFile } from "openai";

const userAgent = "OpenAI File Downloader, XaiImageApiFetch/1.0";

export interface Transcriber {
  transcribe(audio: Uint8Array, mimeType: "audio/mp4"): Promise<string>;
}

export class OpenAITranscriber implements Transcriber {
  private readonly client: OpenAI;

  constructor(apiKey: string, private readonly model = "gpt-transcribe") {
    if (apiKey.length < 20) throw new Error("OPENAI_API_KEY is missing or invalid");
    this.client = new OpenAI({ apiKey, defaultHeaders: { "User-Agent": userAgent } });
  }

  async transcribe(audio: Uint8Array, mimeType: "audio/mp4"): Promise<string> {
    if (audio.byteLength < 1_024 || audio.byteLength > 512 * 1_024) {
      throw new Error("Voice recordings must be between 1 KiB and 512 KiB");
    }
    const file = await toFile(audio, "watch-prompt.m4a", { type: mimeType });
    const response = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      response_format: "json",
    });
    const text = response.text.trim();
    if (!text) throw new Error("The recording did not contain recognizable speech");
    return text.slice(0, 4_000);
  }
}
