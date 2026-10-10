import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
// Explicit full-output rollback/fallback protocol coverage.
beforeEach(()=>vi.stubEnv("AGENTIC_WEAR_DRAFT_FULL_OUTPUT","1"));
afterEach(()=>vi.unstubAllEnvs());
import { LocalDraftEditor } from "../src/draft-editor.js";
const original = "Hey, our meeting was great, and I think I've decided on a color now. I think I want a red Tesla. No, actually a blue Tesla. And I'm looking forward to meeting you again. Let's talk about the price then.";
const preserved = "Hey, our meeting was great, and I think I've decided on a color now. I think I want a blue Tesla. And I'm looking forward to meeting you again. Let's talk about the price then.";
const response = (draft: string) => new Response(JSON.stringify({ done: true, done_reason: "stop", message: { content: JSON.stringify({ draft }) } }));
const edit = (input: string, output: string, current?: string) => new LocalDraftEditor(vi.fn<typeof fetch>().mockResolvedValue(response(output))).rewrite(input, current);
describe("initial dictation preserves the surrounding message", () => {
 it("rejects the reported one-sentence collapse even with the correct color", async () => {
  const result = await edit(original, "I want a blue Tesla.");
  expect(result.text).toBe(original);
  expect(result.notice).toMatch(/omitted part/);
 });
 it("accepts the local color correction with opening, qualifier and closing intact", async () => {
  expect((await edit(original, preserved)).text).toBe(preserved);
 });
 it("rejects dropping only the closing sentence from an otherwise faithful rewrite", async () => {
  const result = await edit(original, preserved.replace(" Let's talk about the price then.", ""));
  expect(result.text).toBe(original);
 });
 it("preserves unrelated context across a different vocabulary and correction", async () => {
  const input = "Thanks for the report. The delivery should arrive Tuesday. No, actually Thursday. Please keep both invoices and call the supplier afterwards.";
  const good = "Thanks for the report. The delivery should arrive Thursday. Please keep both invoices and call the supplier afterwards.";
  expect((await edit(input, good)).text).toBe(good);
  expect((await edit(input, "The delivery should arrive Thursday.")).text).toBe(input);
 });
 it("accepts punctuation, casing and contraction expansion without summarizing", async () => {
  const input = "Hey, our meeting was great. I've decided on a color. Let's talk about the price then.";
  const output = "Hey! Our meeting was great. I have decided on a color. Let us talk about the price then.";
  expect((await edit(input, output)).text).toBe(output);
 });
 it("retains a qualification when the model turns an opinion into certainty", async () => {
  const input = "I think our meeting was great and the project will succeed.";
  expect((await edit(input, "Our meeting was great and the project will succeed.")).text).toBe(input);
 });
 it("continues to allow explicitly requested shortening in a separate edit", async () => {
  const draft = "Yesterday I bought green flowers, and I am very happy with my purchase.";
  expect((await edit("make it more concise", "Yesterday I bought green flowers and I am happy with my purchase.", draft)).text).toBe("Yesterday I bought green flowers and I am happy with my purchase.");
 });
});
