import { describe, expect, it, vi } from "vitest";
import { resolveCopularCorrections } from "../src/copular-correction.js";
import { LocalDraftEditor } from "../src/draft-editor.js";

describe("same-subject local value correction", () => {
  it("resolves the reported correction and compresses its redundant confirmation", async () => {
    const input = "We've bought a Tesla. It's a blue one, right? Oh no, it was the green one. You're right. Yeah, it was the green one. Okay.";
    const expected = "We've bought a Tesla. You're right, it was the green one. Okay.";
    const request = vi.fn<typeof fetch>();
    const result = await new LocalDraftEditor(request).rewrite(input);
    expect(result.text).toBe(expected);
    expect(result.outcome).toBe("deterministic_corrections");
    expect(request).not.toHaveBeenCalled();
  });
  it("uses a general value comparison across vocabulary, subjects, articles and markers", () => {
    const cases = [
      ["It's a small package.", "it was a large package.", "It's a large package."],
      ["Our delivery is Tuesday.", "our delivery is Thursday.", "Our delivery is Thursday."],
      ["The value is twelve.", "the value is thirteen.", "The value is thirteen."],
      ["The quantity is 12.", "the quantity is 13.", "The quantity is 13."],
      ["They're short cables.", "they were long cables.", "They're long cables."],
      ["It’s a blue one, right?", "it was the green one.", "It’s the green one, right?"],
      ["It is an orange box.", "it was a silver box.", "It is a silver box."],
      ["It is a useful example.", "it was an unusual example.", "It is an unusual example."],
    ];
    for (const [before, correction, expected] of cases) for (const cue of ["Oh no, ", "Oh, no! ", "No, ", "No! ", "No, actually "]) {
      const input = `Thanks. ${before} ${cue}${correction} Keep 52 files.\nCall Hendrik tomorrow.`;
      expect(resolveCopularCorrections(input)).toEqual({ text: `Thanks. ${expected} Keep 52 files.\nCall Hendrik tomorrow.`, count: 1 });
    }
  });
  it("retains temporal contrasts, polarity, uncertainty and unrelated information", () => {
    for (const text of [
      "It was blue yesterday. Oh no, it is green today.",
      "It's blue. Oh no, she bought a green one.",
      "I think it's blue. Oh no, it is green.",
      "It's blue. Oh no, maybe it is green.",
      "It isn't blue. Oh no, it is green.",
      "It's a blue one. Oh no, it was green because he changed it.",
      "It's a blue one. Oh no, it was a green one and I have the invoice.",
      "It's a blue one. Oh no, it was the green two.",
      "It was a blue one at noon. Oh no, it is the green one at night.",
      "It's a blue one. Oh no, it is a green one, right?",
      "We bought a car. Oh no, the train is late.",
      "It's a blue one. Oh no, it was the blue one.",
      'Say "It is blue. Oh no, it was green." exactly.',
      "Say 'It is blue. Oh no, it was green.' exactly.",
      "`It is blue. Oh no, it was green.`",
      '"Welcome. It is blue. Oh no, it was green. Goodbye."',
      "‘Welcome. It is blue. Oh no, it was green. Goodbye.’",
      "‘Welcome. It’s a blue one. Oh no, it was green. Goodbye.’",
      'Here is "an unfinished literal. It is blue. Oh no, it was green.',
      "Repeat the following exactly. It is blue. Oh no, it was green.",
      "It is without protection. Oh no, it was with protection.",
      "‘Welcome. It is blue. Oh no, it was green.",
      "’Welcome. It is a blue one. Oh no, it was a green one. Goodbye.’",
      "'Welcome. It is blue. Oh no, it was green.",
      "'Welcome. It's a blue one. Oh no, it was a green one. Goodbye.'",
      "‘Welcome. It’s a blue one. Oh no, it was a green one. Goodbye.’",
      "It was green on Tuesday. Oh no, it is blue on Tuesday.",
      "It is < 12. Oh no, it is > 13.",
      "It is -12. Oh no, it is 13.",
      "It is red-one. Oh no, it is blue one.",
      "It is open. Oh no, it was closed.",
      "'Welcome to the teachers' school. It is a blue one. Oh no, it was a green one. Goodbye.'",
      "‘Welcome to the teachers’ school. It is a blue one. Oh no, it was a green one. Goodbye.’",
      "Why is blue? Oh no, why is green.",
      "What is a blue one? Oh no, what is a green one.",
      "It is /tmp/red.txt. Oh no, it is /tmp/blue.txt.",
      "It is RED. Oh no, it is BLUE.",
      "It is blue. Oh no, the word is green.",
    ]) expect(resolveCopularCorrections(text)).toEqual({ text, count: 0 });
  });
  it("can resolve successive explicit value corrections without removing unrelated facts", () => {
    const input = "It's a blue one. Oh no, it was a green one. No, it was a silver one. Keep 52 files.";
    expect(resolveCopularCorrections(input)).toEqual({ text: "It's a silver one. Keep 52 files.", count: 2 });
  });
  it("leaves existing explicit complex corrections on the bounded model path", async () => {
    const input = "I think I want red flowers. No, actually blue flowers. Keep the invoice.";
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ done: true, done_reason: "stop", message: { content: JSON.stringify({ changes: [["red flowers", "blue flowers"]] }) } })));
    expect((await new LocalDraftEditor(request).rewrite(input)).text).toBe("I think I want blue flowers. Keep the invoice.");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
