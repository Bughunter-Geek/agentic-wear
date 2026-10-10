import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
// Explicit full-output rollback/fallback protocol coverage.
beforeEach(()=>vi.stubEnv("AGENTIC_WEAR_DRAFT_FULL_OUTPUT","1"));
afterEach(()=>vi.unstubAllEnvs());
import { LocalDraftEditor, targetedEdit } from "../src/draft-editor.js";
const response = (draft: string) => new Response(JSON.stringify({done:true,done_reason:"stop",message:{content:JSON.stringify({draft})}}));
describe("local final-intent draft editing",()=>{
 it("replaces one whole occurrence and retains unrelated facts",()=>{
  expect(targetedEdit("Yesterday I bought red flowers.","change red to blue")).toEqual({text:"Yesterday I bought blue flowers."});
  expect(targetedEdit("A red flower and reddish leaves.","replace red with green.")).toEqual({text:"A green flower and reddish leaves."});
 });
 it("asks which of multiple matches rather than silently replacing all",()=>{
  const result=targetedEdit("red flowers beside red curtains","change red to blue");
  expect(result?.text).toBe("red flowers beside red curtains");
  expect(result?.editChoices).toEqual(["blue flowers beside red curtains","red flowers beside blue curtains"]);
 });
 it("bounds ambiguity and retains unmatched drafts",()=>{
  expect(targetedEdit("red " + "x ".repeat(5998),"change red to " + "b".repeat(240))?.text).toBe("red " + "x ".repeat(5998));
  expect(targetedEdit("red ".repeat(6),"change red to blue")?.editChoices).toBeUndefined();
  expect(targetedEdit("green flower","change red to blue")?.text).toBe("green flower");
  expect(targetedEdit("red flower","make this more concise")).toBeNull();
 });
 it("uses local JSON data with no tools and accepts final-intent output",async()=>{
  const request=vi.fn<typeof fetch>().mockResolvedValue(response("Yesterday I bought green flowers."));
  const original="So yesterday I bought red flowers. No, wait, I think it was green flowers. Yeah, it was green flowers.";
  const result=await new LocalDraftEditor(request).rewrite(original);
  expect(result.text).toBe("Yesterday I bought green flowers.");
  const body=JSON.parse(request.mock.calls[0]![1]!.body as string) as Record<string,unknown>;
  expect(body).not.toHaveProperty("tools");
  expect(body.model).toBe("llama3.1:latest");
  expect(JSON.stringify(body.messages)).toContain("yesterday");
 });
 it("keeps the previous draft when complex editing fails or truncates",async()=>{
  for(const fetcher of [vi.fn<typeof fetch>().mockRejectedValue(new DOMException("timeout","TimeoutError")),vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({done:true,done_reason:"length",message:{content:'{"draft":"lost constraint"}'}}))),vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"))]) {
   expect((await new LocalDraftEditor(fetcher).rewrite("make it clearer","Do not delete it.")).text).toBe("Do not delete it.");
  }
 });
 it("uses exact edits without calling a model and refuses overlapping model work",async()=>{
  let finish!: (r:Response)=>void;
  const request=vi.fn<typeof fetch>().mockImplementation(()=>new Promise<Response>(resolve=>{finish=resolve;}));
  const editor=new LocalDraftEditor(request);
  expect((await editor.rewrite("change red to blue","red flower")).text).toBe("blue flower");
  expect(request).not.toHaveBeenCalled();
  const first=editor.rewrite("a useful draft");
  expect((await editor.rewrite("second draft")).text).toBe("second draft");
  expect(request).toHaveBeenCalledTimes(1);
  finish(response("A useful draft.")); await first;
 });
 it("retains the original when initial rewriting changes an explicit prohibition",async()=>{
  const original="Please keep the meeting at nine thirty tomorrow morning. Do not delete the folder, just open it.";
  const request=vi.fn<typeof fetch>().mockResolvedValue(response("Please keep the meeting at nine thirty tomorrow morning. Do not open the folder."));
  expect((await new LocalDraftEditor(request).rewrite(original)).text).toBe(original);
 });
 it("accepts a rewrite that preserves the explicit prohibition",async()=>{
  const request=vi.fn<typeof fetch>().mockResolvedValue(response("Do not delete the folder. Open it."));
  expect((await new LocalDraftEditor(request).rewrite("Um, do not delete the folder, just open it.")).text).toBe("Do not delete the folder. Open it.");
 });
});
