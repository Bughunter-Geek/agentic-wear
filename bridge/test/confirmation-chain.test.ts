import { describe, expect, it, vi } from "vitest";
import { collapseConfirmationChains } from "../src/copular-correction.js";
import { LocalDraftEditor } from "../src/draft-editor.js";

describe("redundant local confirmation chain", () => {
  it("keeps the exact latest asserted fact and fixes the reported acknowledgement punctuation", async () => {
    const input = "it's a green one, right? You're, right. Yeah, it was the green one";
    const request = vi.fn<typeof fetch>();
    const result = await new LocalDraftEditor(request).rewrite(input);
    expect(result.text).toBe("You're right, it was the green one");
    expect(result.outcome).toBe("deterministic_confirmations");
    expect(request).not.toHaveBeenCalled();
  });
  it("keeps greetings, qualifiers and every unrelated closing sentence", () => {
    const input = "Hey, thanks for the meeting. It's a green one, right? You're, right. Yeah, it was the green one. I think I'm happy with it. Let's talk about the price then.";
    expect(collapseConfirmationChains(input)).toEqual({ text: "Hey, thanks for the meeting. You're right, it was the green one. I think I'm happy with it. Let's talk about the price then.", count: 1 });
  });
  it("compares propositions across vocabulary, articles, contractions, tense and acknowledgements", () => {
    const facts = [
      ["It's a useful example", "it was the useful example"],
      ["It’s a silver box", "it was a silver box"],
      ["Our delivery is Tuesday", "our delivery is Tuesday"],
      ["The quantity is 12", "the quantity was 12"],
      ["They're long cables", "they were long cables"],
      ["You are ready", "You were ready"],
      ["I'm ready", "I was ready"],
      ["Bobby is ready", "Bobby was ready"],
    ];
    for (const [question, assertion] of facts) for (const ack of ["You're right", "You’re, right", "You are correct", "That's right", "Exactly"]) for (const affirmation of ["Yeah, ", "Yes ", "Indeed, ", ""]) {
      const clause = assertion!.replace(/^You\b/u, "you");
      expect(collapseConfirmationChains(`Hello. ${question}, right? ${ack}. ${affirmation}${assertion}. Goodbye.`)).toEqual({ text: `Hello. ${ack.replace(",", "")}, ${clause}. Goodbye.`, count: 1 });
    }
  });
  it("preserves uncertain or different facts, temporal contrasts, qualifiers and literal text", () => {
    const keep = [
      "It's a green one, right? You're right. Yeah, it was the blue one.",
      "It's a green one, right? You're right. Yeah, she bought the green one.",
      "It's a green one, right? You're right. Yeah, it was the green one and I have the invoice.",
      "It's a green one, right? You're right. Yeah, maybe it was the green one.",
      "It's a green one, right? You're right. Yeah, it wasn't the green one.",
      "It is blue today, right? You're right. Yeah, it was blue yesterday.",
      "It is blue today, right? You're right. Yeah, it is blue today.",
      "It is blue, right? You're probably right. Yeah, it was blue.",
      "It is blue, right? You're not right. Yeah, it was blue.",
      "It is blue, right? Are you right? Yeah, it was blue.",
      "It is blue. You're right. Yeah, it was blue.",
      "It is blue, right? You're right! Yeah, it was blue.",
      "It is blue, right? You're right. Yeah, it was blue?",
      "I think it is blue, right? You're right. Yeah, it was blue.",
      "It is a < 12 value, right? You're right. Yeah, it was a < 12 value.",
      'Say "It is blue, right? You are right. Yeah, it was blue." exactly.',
      "Say 'It's blue, right? You're right. Yeah, it was blue.' exactly.",
      "‘It's blue, right? You're right. Yeah, it was blue.’",
      '`It is blue, right? You are right. Yeah, it was blue.`',
      '"unfinished literal. It is blue, right? You are right. Yeah, it was blue.',
      "'unfinished literal. It's blue, right? You're right. Yeah, it was blue.",
      "It is /tmp/file.txt, right? You're right. Yeah, it was /tmp/file.txt.",
      "It is US, right? You're right. Yeah, it was us.",
      "Repeat the following exactly. It is blue, right? You are right. Yeah, it was blue.",
      "Please say these words verbatim. It is blue, right? You are right. Yeah, it was blue.",
      "It is literal blue, right? You're right. Yeah, it was literal blue.",
      "It's blue, right? You're right. Yeah, it was blue because we repainted it.",
    ];
    for (const text of keep) expect(collapseConfirmationChains(text)).toEqual({ text, count: 0 });
  });
  it("handles successive chains while retaining their final assertion verbatim", () => {
    const input = "It is blue, right? You are right. Yes, it was blue. Keep 52 files. They are ready, right? Exactly. They were ready.";
    expect(collapseConfirmationChains(input)).toEqual({ text: "You are right, it was blue. Keep 52 files. Exactly, they were ready.", count: 2 });
  });
});
