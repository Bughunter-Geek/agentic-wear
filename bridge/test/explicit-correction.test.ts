import { describe, expect, it, vi } from "vitest";
import { resolveExplicitClauseCorrections } from "../src/explicit-correction.js";
import { LocalDraftEditor } from "../src/draft-editor.js";
const observed = "Yesterday I saw a blue car. No, wait, it was a red car and there was a man in it and he was waving to me. No. Actually, he was flipping his finger on me. Okay, anyways, was an interesting experience.";
const expected = "Yesterday I saw a red car and there was a man in it and he was flipping his finger on me. Okay, anyways, was an interesting experience.";
describe("explicit corrections with punctuation variants and added facts", () => {
  it("resolves the exact Watch result and retains the full surrounding story", async () => {
    expect(resolveExplicitClauseCorrections(observed)).toEqual({ text: expected, count: 2 });
    const request = vi.fn<typeof fetch>();
    const edited = await new LocalDraftEditor(request).rewrite(observed, undefined, { explicitCorrections: true });
    expect(edited.text).toBe(expected);
    expect(edited.outcome).toBe("deterministic_explicit_repair");
    expect(request).not.toHaveBeenCalled();
  });
  it("supports spoken cue punctuation across sentences without a word whitelist", () => {
    for (const cue of ["No, wait, ", "No, wait. ", "No. Wait, ", "No, actually, ", "No. Actually, "]) {
      for (const [oldValue, newValue, noun] of [["blue", "red", "car"], ["small", "large", "package"], ["silver", "gold", "ring"]]) {
        const input = `Yesterday I saw a ${oldValue} ${noun}. ${cue}it was a ${newValue} ${noun} and it belonged to Hendrik. Keep 52 files.`;
        expect(resolveExplicitClauseCorrections(input).text).toBe(`Yesterday I saw a ${newValue} ${noun} and it belonged to Hendrik. Keep 52 files.`);
      }
      const input = `There was a man and he was waving to me. ${cue}he was pointing at me. We met later.`;
      expect(resolveExplicitClauseCorrections(input).text).toBe("There was a man and he was pointing at me. We met later.");
    }
  });
  it("preserves the user's spoken punctuation and independent facts", () => {
    const input = "Yesterday I saw a blue car. No, wait. It was a red car, and there was a man in it, and he was waving to me. No, actually, he was flipping his finger on me. Okay, anyway, was an interesting experience.";
    expect(resolveExplicitClauseCorrections(input).text).toBe("Yesterday I saw a red car, and there was a man in it, and he was flipping his finger on me. Okay, anyway, was an interesting experience.");
  });
  it("does not overwrite coordinated actions, temporal contrasts, uncertainty or literals", () => {
    for (const text of [
      "He was waving and singing. No, actually, he was pointing.",
      "He was waving yesterday. No, actually, he was pointing today.",
      "He was maybe waving. No, actually, he was pointing.",
      "He wasn't waving. No, actually, he was pointing.",
      "Do not buy a blue car. No, actually, it was a red car.",
      "Don't buy a blue car. No, actually, it was a red car.",
      "He was waving. No, actually, she was pointing.",
      "He was holding 12 flowers. No, actually, he was holding 13 flowers.",
      "I saw a blue car and a green car. No, actually, it was a red car.",
      'Say "He was waving. No, actually, he was pointing." exactly.',
      "He was holding /tmp/red.txt. No, actually, he was holding /tmp/blue.txt.",
    ]) expect(resolveExplicitClauseCorrections(text)).toEqual({ text, count: 0 });
  });
});
