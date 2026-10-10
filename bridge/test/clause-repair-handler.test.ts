import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeService } from "../src/bridge-service.js";
import { LocalDraftEditor } from "../src/draft-editor.js";

const raw = "This is just a bill. This is just a test.";
afterEach(() => vi.unstubAllEnvs());
async function run(input = raw, options: { backend?: "phonon" | "whisper"; finalIntent?: boolean; previousText?: string } = {}) {
  const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected model call"));
  const send = vi.fn();
  const service = Object.create(BridgeService.prototype);
  Object.assign(service, { config: { defaultCwd: "/tmp" }, transcriber: { defaultBackend: "phonon", transcribe: async () => input },
    draftEditor: new LocalDraftEditor(request), send, appServer: { reviseDraft: async () => options.previousText } });
  await service.createTranscription({ version: 1, kind: "transcription.create", requestId: "synthetic-clause-repair", threadId: null,
    backend: options.backend ?? "phonon", mimeType: "audio/aac", audioBase64: Buffer.alloc(2048).toString("base64"),
    finalIntent: options.finalIntent ?? true, ...(options.previousText ? { previousText: options.previousText, localEdit: true } : {}) });
  return { result: send.mock.calls[0]![0] as { text: string; rawText?: string; editNotice?: string; editChoices?: string[] }, request };
}
describe("initial cleaned Phonon clause repair", () => {
  it("repairs the exact confirmed false start without generating text or calling a model", async () => {
    const { result, request } = await run();
    expect(result.text).toBe("This is just a test.");
    expect(result.rawText).toBe(raw);
    expect(result.editNotice).toMatch(/Possible clause restart removed/);
    expect(result.editChoices).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });
  it("keeps all surrounding greeting, context, facts and closing words", async () => {
    const input = "Hi, Hendrik. This is just a bill. This is just a test. Keep all 52 files and call tomorrow.";
    const { result, request } = await run(input);
    expect(result.text).toBe("Hi, Hendrik. This is just a test. Keep all 52 files and call tomorrow.");
    expect(result.rawText).toBe(input);
    expect(request).not.toHaveBeenCalled();
  });
  it("does not infer clause repairs for Whisper or plain transcription requests", async () => {
    for (const options of [{ backend: "whisper" as const }, { finalIntent: false }]) {
      const { result, request } = await run(raw, options);
      expect(result.text).toBe(raw);
      expect(request).not.toHaveBeenCalled();
    }
  });
  it("preserves the existing cleanup opt-out and independent clause-repair rollback", async () => {
    for (const variable of ["AGENTIC_WEAR_PHONON_CLEAN_FILLERS", "AGENTIC_WEAR_PHONON_CLAUSE_REPAIRS"]) {
      vi.stubEnv(variable, "0");
      const { result, request } = await run();
      expect(result.text).toBe(raw);
      expect(result.rawText).toBe(raw);
      expect(request).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    }
  });
  it("retains original separate statements, quotation and intentional complete echoes", async () => {
    for (const input of ["This is a bill. This is a test.", "I bought a car. I bought a boat.",
      "This is just a test. This is just a test.", 'Say "This is just a bill. This is just a test." exactly.',
      "This is just a bill. Also, this is just a test.", "This is just a bill for 52 euros. This is just a test."]) {
      const { result, request } = await run(input);
      expect(result.text).toBe(input);
      expect(result.rawText).toBe(input);
      expect(request).not.toHaveBeenCalled();
    }
  });
  it("retains the visible possible-repair notice if a separate model correction fails", async () => {
    const input = raw + " I want a red flower. No, actually a blue flower.";
    const { result, request } = await run(input);
    expect(result.text).toBe("This is just a test. I want a red flower. No, actually a blue flower.");
    expect(result.rawText).toBe(input);
    expect(result.editNotice).toMatch(/Possible clause restart removed/);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("preserves the existing full-output rollback path", async () => {
    vi.stubEnv("AGENTIC_WEAR_DRAFT_FULL_OUTPUT", "1");
    const { result, request } = await run();
    expect(result.text).toBe(raw);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not automatically modify an existing draft through the new initial-only rule", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const result = await new LocalDraftEditor(request).rewrite("No change", raw, { clauseRestarts: true });
    expect(result.text).toBe(raw);
    expect(result.outcome).toBe("unavailable");
  });
});
