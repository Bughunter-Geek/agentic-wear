import { describe, expect, it } from "vitest";
import { collapseRevisedClauseRestarts } from "../src/copular-correction.js";

describe("optional inferred revised-ending clause repair", () => {
  it("repairs the reported ASR-normalized abandoned clause without a noun whitelist", () => {
    expect(collapseRevisedClauseRestarts("This is just a bill. This is just a test.")).toEqual({ text: "This is just a test.", count: 1 });
  });
  it("uses the same structural rule across subjects, copulas, scaffolds and vocabulary", () => {
    for (const subject of ["This", "That", "It"]) for (const copula of ["is", "was"]) for (const scaffold of ["just", "simply", "merely"]) {
      for (const [from, to] of [["draft", "sketch"], ["note", "memo"], ["chair", "table"], ["sample", "test"], ["preview", "demo"]]) {
        const first = `${subject} ${copula} ${scaffold} a ${from}.`;
        const final = `${subject} ${copula} ${scaffold} a ${to}.`;
        expect(collapseRevisedClauseRestarts(`Hello.\n${first} ${final} Thanks for checking.\nKeep the invoice.`)).toEqual({
          text: `Hello.\n${final} Thanks for checking.\nKeep the invoice.`, count: 1,
        });
      }
    }
  });
  it("normalizes case and contraction apostrophes but copies the final clause verbatim", () => {
    for (const [first, final] of [
      ["It's just a note.", "It’s just a memo."],
      ["IT’S just a draft.", "It's just a sketch."],
      ["This is just a bill.", "this is just a test"],
      ["This is just a preliminary draft.", "This is just a preliminary sketch."],
    ]) expect(collapseRevisedClauseRestarts(`${first}  ${final}`)).toEqual({ text: final, count: 1 });
  });
  it("can collapse several adjacent attempts, with bounded passes", () => {
    const input = "This is just a bill. This is just a draft. This is just a test. Goodbye.";
    expect(collapseRevisedClauseRestarts(input)).toEqual({ text: "This is just a test. Goodbye.", count: 2 });
    const attempts = ["bill", "draft", "note", "memo", "sample", "preview", "demo", "sketch", "test"]
      .map(value => `This is just a ${value}.`);
    expect(collapseRevisedClauseRestarts(attempts.join(" "))).toEqual({ text: attempts.slice(6).join(" "), count: 6 });
  });
  it("preserves distinct statements, complete echoes and insufficient restart evidence", () => {
    for (const text of [
      "I bought a car. I bought a boat.",
      "This is a cat. This is a dog.",
      "This is just red. This is just blue.",
      "The invoice is just a bill. The invoice is just a test.",
      "This is just a bill. That is just a test.",
      "This is just a bill. This was just a test.",
      "This is just a bill. This is just a bill.",
      "This is just a bill! This is just a test.",
      "This is just a bill. This is just a test?",
      "This is just a bill.\nThis is just a test.",
      "This is just a bill. Also, this is just a test.",
      "This is just a bill. This is simply a test.",
      "This is just a red box. This is just a blue box.",
      "This is just a bill. This is just a test and a report.",
      "This is just a bill. This is just a different test.",
      "This is just another bill. This is just another test.",
    ]) expect(collapseRevisedClauseRestarts(text)).toEqual({ text, count: 0 });
  });
  it("preserves names, acronyms, numbers, polarity, uncertainty and temporal facts", () => {
    for (const text of [
      "This is just a Bill. This is just a Test.",
      "This is just a PDF. This is just a DOC.",
      "This is just a 12. This is just a 13.",
      "This is just a twelve. This is just a thirteen.",
      "This is just a first. This is just a second.",
      "This is not just a bill. This is not just a test.",
      "This isn't just a bill. This isn't just a test.",
      "This is probably just a bill. This is probably just a test.",
      "This is just a possible bill. This is just a possible test.",
      "This is just a likely bill. This is just a likely test.",
      "This is just an estimated bill. This is just an estimated test.",
      "This was just a former bill. This was just a former test.",
      "This is just a bill today. This is just a test tomorrow.",
      "This is just a bill at noon. This is just a test at noon.",
      "This is just a bill without tax. This is just a test without tax.",
      "This is just a bill or report. This is just a test or report.",
    ]) expect(collapseRevisedClauseRestarts(text)).toEqual({ text, count: 0 });
  });
  it("preserves literals, code, paths and preceding spelling/list directives", () => {
    for (const text of [
      '"This is just a bill. This is just a test."',
      '"Welcome. This is just a bill. This is just a test. Goodbye."',
      "'This is just a bill. This is just a test.'",
      "‘This is just a bill. This is just a test.’",
      '"An unfinished quotation. This is just a bill. This is just a test.',
      "`This is just a bill. This is just a test.`",
      "This is just a /tmp/bill. This is just a /tmp/test.",
      "This is just a bill.txt. This is just a test.txt.",
      "This is just a bill-code. This is just a test-code.",
      "Repeat the following exactly. This is just a bill. This is just a test.",
      "Please read these words. This is just a bill. This is just a test.",
      "Spell this aloud. This is just a bill. This is just a test.",
      "Here are two examples. This is just a bill. This is just a test.",
      "List the items. This is just a bill. This is just a test.",
      "First statement. This is just a bill. This is just a test.",
    ]) expect(collapseRevisedClauseRestarts(text)).toEqual({ text, count: 0 });
  });
});
