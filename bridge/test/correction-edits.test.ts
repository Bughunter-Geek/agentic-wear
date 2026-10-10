import { describe, expect, it, vi } from "vitest";
import { LocalDraftEditor, findShortCorrections, applyShortCorrections } from "../src/draft-editor.js";
const response=(changes:[string,string][])=>new Response(JSON.stringify({done:true,done_reason:"stop",message:{content:JSON.stringify({changes})}}));
const original="So bro, I think we should go for the red Tesla. No, actually the blue one. Because my girlfriend also loves the blue one. I think I've decided that I want the blue one. If you're good with it, let's go with the blue one. Can't wait to meet you again. Let's talk the price and how we split the bill. So amazing.";
describe("short exact correction output preserves context",()=>{
 it("resolves the reported long sample with only the local value generated",async()=>{
  const request=vi.fn<typeof fetch>().mockResolvedValue(response([["red Tesla","blue Tesla"]]));
  const result=await new LocalDraftEditor(request).rewrite(original);
  expect(result.text).toBe(original.replace("red Tesla. No, actually the blue one.","blue Tesla."));
  expect(result.outcome).toBe("accepted_corrections");
  const body=JSON.parse(request.mock.calls[0]![1]!.body as string) as {model:string;messages:{content:string}[];options:unknown};
  expect(body.model).toBe("llama3.1:latest");expect(body.options).toEqual({temperature:0,num_ctx:2048,num_predict:512});
  expect(JSON.parse(body.messages[1]!.content).spans).toEqual([{before:"So bro, I think we should go for the red Tesla.",correction:"No, actually the blue one."}]);
 });
 it("avoids model generation for already cleaned dictation without explicit corrections",async()=>{
  const request=vi.fn<typeof fetch>();const text="I think our meeting was great. Let's discuss the price tomorrow.";
  const result=await new LocalDraftEditor(request).rewrite(text);
  expect(result.text).toBe(text);expect(result.outcome).toBe("deterministic_only");expect(request).not.toHaveBeenCalled();
 });
 it("preserves exact surrounding whitespace and independent facts across diverse values",()=>{
  for(const [from,to] of [["red","blue"],["Tuesday","Thursday"],["twelve","thirteen"],["silver","gold"],["12","13"]]) {
   const text=`Thanks for meeting.\nI think the value is ${from}. No, actually ${to}.\nKeep 9 invoices and call Hendrik.`;
   const spans=findShortCorrections(text)!;
   expect(applyShortCorrections(text,spans,[[from!,to!]])).toBe(text.replace(`is ${from}. No, actually ${to}.`,`is ${to}.`));
  }
 });
 it("handles two independent corrections transactionally and retains qualifications",()=>{
  const text="I think delivery is Tuesday. No, actually Thursday. Please bring red flowers. No, actually blue flowers. Keep 9 invoices.";
  expect(applyShortCorrections(text,findShortCorrections(text)!,[["Tuesday","Thursday"],["red flowers","blue flowers"]])).toBe("I think delivery is Thursday. Please bring blue flowers. Keep 9 invoices.");
 });
 it("rejects nonexistent, ambiguous, substring and wrong-count replacements",()=>{
  const text="A red car and red bike. No, actually a blue bike.";const spans=findShortCorrections(text)!;
  for(const changes of [[["red","blue"]],[["green","blue"]],[["ed bike","blue bike"]],[],[["",""]]] as [string,string][][])
   expect(applyShortCorrections(text,spans,changes)).toBeNull();
 });
 it("retains extra information in correction sentences instead of dropping it",async()=>{
  const text="I think I want red flowers. No, actually blue flowers because my sister loves them. Keep the invoice.";
  const result=await new LocalDraftEditor(vi.fn<typeof fetch>().mockResolvedValue(response([["red flowers","blue flowers"]]))).rewrite(text);
  expect(result.text).toBe(text);expect(result.outcome).toBe("correction_guard");
 });
 it("refuses loss of qualifiers, quoted words and paths",()=>{
  for(const [text,from,to] of [["I think red is suitable. No, actually blue.","I think red","Blue"],["Use /tmp/red. No, actually blue.","/tmp/red","blue"],["Call 'Red' tomorrow. No, actually Blue.","'Red'","Blue"]]) {
   const spans=findShortCorrections(text!);expect(spans).not.toBeNull();
   expect(applyShortCorrections(text!,spans!,[[from!,to!]])).toBeNull();
  }
 });
 it("keeps inline and chained corrections on the existing bounded full-output path",async()=>{
  const text="Thanks. I want red flowers, no, actually blue flowers. See you Friday.";
  expect(findShortCorrections(text)).toBeNull();
  expect(findShortCorrections("I want red. No, actually blue. No, actually green.")).toBeNull();
  const good="Thanks. I want blue flowers. See you Friday.";
  const request=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({done:true,done_reason:"stop",message:{content:JSON.stringify({draft:good})}})));
  expect((await new LocalDraftEditor(request).rewrite(text)).text).toBe(good);
 });
 it("retains an explicit prohibition even if a model tries to overwrite it",async()=>{
  const text="Do not delete the folder. No, actually open it. Keep 9 invoices.";
  const result=await new LocalDraftEditor(vi.fn<typeof fetch>().mockResolvedValue(response([["Do not delete the folder","Open it"]]))).rewrite(text);
  expect(result.text).toBe(text);expect(result.outcome).toBe("prohibition_guard");
 });
});
