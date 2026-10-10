import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveExplicitClauseCorrections, type ExplicitCorrectionDiagnostics } from "../src/explicit-correction.js";
import { LocalDraftEditor } from "../src/draft-editor.js";
import { BridgeService } from "../src/bridge-service.js";
const expected = "Yesterday I saw a red car and there was a man in it and he was flipping his finger on me. Okay, anyways, was an interesting experience.";
const gaps = [". No, wait, ", ", no, wait, ", " no wait ", " — No, wait — ", "; No. Wait, ", ". No, wait. "];
const secondGaps = [". No, actually, ", ", no, actually, ", " no actually ", " — No, actually — ", "; No. Actually, ", ". No, actually. "];
const stories = gaps.flatMap(first => secondGaps.map(second =>
  `Yesterday I saw a blue car${first}it was a red car and there was a man in it and he was waving to me${second}he was flipping his finger on me. Okay, anyways, was an interesting experience.`));
afterEach(() => vi.restoreAllMocks());
describe("correction cues independent of ASR sentence boundaries", () => {
  it("resolves both story corrections across a generated punctuation matrix", async () => {
    for (const input of stories) {
      let diagnostic: ExplicitCorrectionDiagnostics | undefined;
      expect(resolveExplicitClauseCorrections(input, d => { diagnostic = d; })).toEqual({ text: expected, count: 2 });
      expect(diagnostic).toMatchObject({ version: "explicit-align-3", cueCount: 2, resolvedCount: 2, remainingCueCount: 0 });
      const request = vi.fn<typeof fetch>();
      const edited = await new LocalDraftEditor(request).rewrite(input, undefined, { explicitCorrections: true });
      expect(edited.text).toBe(expected);expect(request).not.toHaveBeenCalled();
    }
  });
  it("uses structural matching across diverse nouns and actions", () => {
    for (const separator of [", ", " ", " — ", "; ", ". "]) {
      for (const [oldValue, newValue, noun] of [["small", "large", "package"], ["silver", "gold", "ring"], ["old", "new", "bicycle"], ["wooden", "metal", "chair"]]) {
        const input = `I saw a ${oldValue} ${noun}${separator}no actually it was a ${newValue} ${noun} and it belonged to Hendrik. Keep 52 files.`;
        expect(resolveExplicitClauseCorrections(input).text).toBe(`I saw a ${newValue} ${noun} and it belonged to Hendrik. Keep 52 files.`);
      }
      for (const [oldAction, newAction] of [["singing", "speaking"], ["running", "walking"], ["laughing", "smiling"]]) {
        const input = `There was a woman and she was ${oldAction}${separator}no wait she was ${newAction}. We met later.`;
        expect(resolveExplicitClauseCorrections(input).text).toBe(`There was a woman and she was ${newAction}. We met later.`);
      }
    }
  });
  it("keeps uncertain, grammatical, literal, numerical and independent facts", () => {
    for (const separator of [". ", ", ", " "]) for (const [before, correction] of [
      ["He was waving and singing", "he was pointing"],
      ["He was waving yesterday", "he was pointing today"],
      ["He was maybe waving", "he was pointing"],
      ["He wasn't waving", "he was pointing"],
      ["Do not buy a blue car", "it was a red car"],
      ["He was waving", "she was pointing"],
      ["He was waving", "he is pointing"],
      ["He was holding 12 flowers", "he was holding 13 flowers"],
      ["I saw a blue car and a green car", "it was a red car"],
      ["He was with Alice", "he was with Bob"],
      ["He was holding /tmp/red.txt", "he was holding /tmp/blue.txt"],
    ]) {
      const input = `${before}${separator}no actually ${correction}.`;
      expect(resolveExplicitClauseCorrections(input)).toEqual({ text: input, count: 0 });
    }
    for (const input of [
      'Say "He was waving, no actually he was pointing" exactly.',
      "The sign says no wait time, actually the line is open.",
      "No, wait, he was pointing.",
      "He was waving. No, actually, was pointing.",
    ]) expect(resolveExplicitClauseCorrections(input)).toEqual({ text: input, count: 0 });
  });
  it("keeps unrelated earlier sentences and added facts byte for byte", () => {
    const input = "We discussed 52 files with Hendrik. I saw a small package, no wait it was a large package and it arrived before noon. Keep the receipt.";
    expect(resolveExplicitClauseCorrections(input).text).toBe("We discussed 52 files with Hendrik. I saw a large package and it arrived before noon. Keep the receipt.");
  });
  it("collects only counts and categories for unresolved cues", () => {
    let diagnostic: ExplicitCorrectionDiagnostics | undefined;
    const input = "He was waving, no actually she was pointing.";
    resolveExplicitClauseCorrections(input, d => { diagnostic = d; });
    expect(diagnostic).toMatchObject({ cueCount: 1, inlineCueCount: 1, resolvedCount: 0, remainingCueCount: 1, skips: { ambiguousTarget: 1 } });
    expect(JSON.stringify(diagnostic)).not.toContain("waving");expect(JSON.stringify(diagnostic)).not.toContain("pointing");
  });
  it("runs through the production handler, retaining raw and reporting the fast path", async () => {
    const input = stories[14]!;const request = vi.fn<typeof fetch>();const send = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const service = Object.create(BridgeService.prototype);
    Object.assign(service, { config: { defaultCwd: "/tmp" }, transcriber: { defaultBackend: "phonon", transcribe: async () => input },
      draftEditor: new LocalDraftEditor(request), send });
    await service.createTranscription({ version: 1, kind: "transcription.create", requestId: "synthetic-inline-cue", threadId: null,
      backend: "phonon", finalIntent: true, mimeType: "audio/aac", audioBase64: Buffer.alloc(2048).toString("base64") });
    expect(send.mock.calls[0]![0]).toMatchObject({ text: expected, rawText: input });expect(request).not.toHaveBeenCalled();
    const timing = log.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .find(value => value.message === "transcription.bridge.timing");
    expect(timing).toMatchObject({ rewriteOutcome: "deterministic_explicit_repair",
      explicitRepairDiagnostics: { version: "explicit-align-3", cueCount: 2, resolvedCount: 2, remainingCueCount: 0 } });
    expect(JSON.stringify(timing)).not.toContain("flipping");expect(JSON.stringify(timing)).not.toContain("Yesterday");
  });
});
