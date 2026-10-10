import type { AudioMimeType, Transcriber } from "./transcriber.js";

/** Explicit watch choice wins; legacy build-51 requests retain the configured default. */
export class SelectableTranscriber implements Transcriber {
  constructor(
    private readonly defaultTranscriber: Transcriber,
    private readonly backends: Partial<Record<"phonon" | "whisper", Transcriber>>,
    readonly defaultBackend?: "phonon" | "whisper",
  ) {}
  async prepare(): Promise<void> { await this.defaultTranscriber.prepare?.(); }
  async transcribe(audio: Uint8Array, mimeType: AudioMimeType, backend?: "phonon" | "whisper"): Promise<string> {
    const target = backend === undefined ? this.defaultTranscriber : this.backends[backend];
    if (!target) throw new Error(`The selected ${backend} backend is not configured on your private Mac bridge`);
    return target.transcribe(audio, mimeType);
  }
  async close(): Promise<void> {
    await Promise.all([...new Set([this.defaultTranscriber, ...Object.values(this.backends)])].map(async (target) => { await target.close?.(); }));
  }
}
