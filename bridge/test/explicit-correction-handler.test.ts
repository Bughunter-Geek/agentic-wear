import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeService } from "../src/bridge-service.js";
import { LocalDraftEditor } from "../src/draft-editor.js";
const raw = "Yesterday I saw a blue car. No, wait, it was a red car and there was a man in it and he was waving to me. No. Actually, he was flipping his finger on me. Okay, anyways, was an interesting experience.";
const expected = "Yesterday I saw a red car and there was a man in it and he was flipping his finger on me. Okay, anyways, was an interesting experience.";
afterEach(() => vi.unstubAllEnvs());
async function run(backend: "phonon" | "whisper" = "phonon", finalIntent = true) {
  const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline synthetic model"));
  const send = vi.fn();const service = Object.create(BridgeService.prototype);
  Object.assign(service, { config: { defaultCwd: "/tmp" }, transcriber: { defaultBackend: "phonon", transcribe: async () => raw }, draftEditor: new LocalDraftEditor(request), send });
  await service.createTranscription({ version: 1, kind: "transcription.create", requestId: "synthetic-explicit-repair", threadId: null,
    backend, finalIntent, mimeType: "audio/aac", audioBase64: Buffer.alloc(2048).toString("base64") });
  return { result: send.mock.calls[0]![0] as { text: string; rawText?: string }, request };
}
describe("explicit narrative correction in the initial Phonon draft", () => {
  it("repairs both values, retains raw and every independent fact, and skips model generation", async () => {
    const { result, request } = await run();
    expect(result.text).toBe(expected);expect(result.rawText).toBe(raw);expect(request).not.toHaveBeenCalled();
  });
  it("preserves separate transcription, Whisper and rollback behavior", async () => {
    expect((await run("phonon", false)).result.text).toBe(raw);
    const whisper = await run("whisper");expect(whisper.result.text).toBe(raw);expect(whisper.request).toHaveBeenCalledTimes(1);
    for (const variable of ["AGENTIC_WEAR_PHONON_EXPLICIT_REPAIRS", "AGENTIC_WEAR_PHONON_CLEAN_FILLERS"]) {
      vi.stubEnv(variable, "0");const disabled = await run();
      expect(disabled.result.text).toBe(raw);expect(disabled.result.rawText).toBe(raw);
      expect(disabled.request).toHaveBeenCalledTimes(1);vi.unstubAllEnvs();
    }
  });
});
