import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
// Explicit full-output rollback/fallback protocol coverage.
beforeEach(()=>vi.stubEnv("AGENTIC_WEAR_DRAFT_FULL_OUTPUT","1"));
afterEach(()=>vi.unstubAllEnvs());
import { BridgeService } from "../src/bridge-service.js";
import { LocalDraftEditor } from "../src/draft-editor.js";
const raw = "Hmm, Um, I I think our meeting was great. uh, hmm, let's discuss the price tomorrow.";
const cleaned = "I think our meeting was great. let's discuss the price tomorrow.";
const response = (draft: string) => new Response(JSON.stringify({ done: true, done_reason: "stop", message: { content: JSON.stringify({ draft }) } }));
async function run(request: typeof fetch, previousText?: string) {
 const sent: Record<string, unknown>[] = [];
 const service = Object.create(BridgeService.prototype) as Record<string, unknown>;
 Object.assign(service, {config:{defaultCwd:"/tmp"}, transcriber:{defaultBackend:"phonon",transcribe:async()=>raw}, draftEditor:new LocalDraftEditor(request),send:async (x:Record<string,unknown>)=>{sent.push(x);} });
 await (service.createTranscription as (p:unknown)=>Promise<void>).call(service,{kind:"transcription.create",requestId:"synthetic",threadId:null,backend:"phonon",mimeType:"audio/aac",audioBase64:Buffer.alloc(2048).toString("base64"),finalIntent:true,...(previousText?{localEdit:true,previousText}:{})});
 return sent[0]!;
}
describe("final Phonon draft keeps cleanup across model outcomes",()=>{
 it("cleans fillers and repeats reintroduced by an accepted model result and retains raw",async()=>{
  const result=await run(vi.fn<typeof fetch>().mockResolvedValue(response(raw)));
  expect(result.text).toBe(cleaned); expect(result.rawText).toBe(raw);
 });
 it("keeps cleaned dictation when the content guard rejects a summary",async()=>{
  const result=await run(vi.fn<typeof fetch>().mockResolvedValue(response("Our meeting was great.")));
  expect(result.text).toBe(cleaned);expect(result.rawText).toBe(raw);expect(result.editNotice).toMatch(/Cleaned dictation retained/);
 });
 it("keeps deterministic improvements when the rewrite request fails",async()=>{
  const result=await run(vi.fn<typeof fetch>().mockRejectedValue(new DOMException("timeout","TimeoutError")));
  expect(result.text).toBe(cleaned);expect(result.rawText).toBe(raw);expect(result.editNotice).toMatch(/unavailable/);
 });
 it("protects literal words in a successful edited draft",async()=>{
  const output='I think our meeting was great. Say "uh" exactly and discuss the price tomorrow.';
  expect((await run(vi.fn<typeof fetch>().mockResolvedValue(response(output)))).text).toBe(output);
 });
 it("does not clean separately requested edits to literal drafts",async()=>{
  const original='Um is the name. Uh is another name.';
  expect((await run(vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),original)).text).toBe(original);
 });
 it("preserves the explicit cleanup opt-out",async()=>{
  vi.stubEnv("AGENTIC_WEAR_PHONON_CLEAN_FILLERS","0");
  try { expect((await run(vi.fn<typeof fetch>().mockResolvedValue(response(raw)))).text).toBe(raw); }
  finally {vi.unstubAllEnvs();}
 });
});
