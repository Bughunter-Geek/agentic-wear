import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
// Explicit full-output rollback/fallback protocol coverage.
beforeEach(()=>vi.stubEnv("AGENTIC_WEAR_DRAFT_FULL_OUTPUT","1"));
afterEach(()=>vi.unstubAllEnvs());
import {LocalDraftEditor} from "../src/draft-editor.js";
const response=()=>new Response(JSON.stringify({done:true,done_reason:"stop",message:{content:'{"draft":"Yesterday I bought green flowers."}'},load_duration:1000000,prompt_eval_duration:2000000,eval_duration:3000000,eval_count:12}));
describe("recording-time local draft preparation",()=>{
 it("coalesces warmups, waits for preparation, and preserves actual rewrite settings",async()=>{
  let finish!: (r:Response)=>void;
  const request=vi.fn<typeof fetch>().mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;})).mockResolvedValue(response());
  const editor=new LocalDraftEditor(request);
  const first=editor.prepare(); const duplicate=editor.prepare();
  expect(first).toBe(duplicate);
  const rewrite=editor.rewrite("Yesterday red, no green flowers.");
  expect(request).toHaveBeenCalledTimes(1);
  finish(response()); await first;
  expect((await rewrite).text).toBe("Yesterday I bought green flowers.");
  expect(request).toHaveBeenCalledTimes(2);
  const bodies=request.mock.calls.map(call=>JSON.parse(call[1]!.body as string) as {keep_alive:string|number;options:{num_predict:number;temperature:number;num_ctx:number}});
  expect(bodies[0]?.options.num_predict).toBe(1);
  expect(bodies[1]?.options).toEqual({temperature:0,num_ctx:2048,num_predict:512});
  expect(bodies[0]?.keep_alive).toBe(-1);
  expect(bodies[1]?.keep_alive).toBe(-1);
 });
 it("supports an isolated rollback of voice-editor residency",async()=>{
  vi.stubEnv("AGENTIC_WEAR_DRAFT_KEEP_ALIVE","10m");
  const request=vi.fn<typeof fetch>().mockResolvedValue(response());
  const editor=new LocalDraftEditor(request);await editor.prepare();
  await editor.rewrite("Yesterday red, no green flowers.");
  for(const call of request.mock.calls) expect(JSON.parse(call[1]!.body as string).keep_alive).toBe("10m");
 });
 it("timing metadata never contains draft content or IDs",async()=>{
  const log=vi.spyOn(console,"log").mockImplementation(()=>undefined);
  try {
   const editor=new LocalDraftEditor(vi.fn<typeof fetch>().mockImplementation(async()=>response()));
   await editor.prepare(); await editor.rewrite("private-synthetic-content");
   const output=JSON.stringify(log.mock.calls);
   expect(output).toContain("draft.model.timing");
   expect(output).not.toContain("private-synthetic-content");
   expect(output).not.toContain("Yesterday");
   expect(output).toContain('loadMs');
  } finally {log.mockRestore();}
 });
 it("an expired overall deadline while preparing retains original instead of waiting indefinitely",async()=>{
  const controller=new AbortController();
  const warmupController=new AbortController();
  const timeout=vi.spyOn(AbortSignal,"timeout").mockImplementation(ms=>ms===60_000?warmupController.signal:controller.signal);
  let finish!: (r:Response)=>void;
  try {
   const request=vi.fn<typeof fetch>().mockImplementation(()=>new Promise<Response>(resolve=>{finish=resolve;}));
   const editor=new LocalDraftEditor(request);
   const prepare=editor.prepare();
   const draft=editor.rewrite("original draft");
   controller.abort();
   expect((await draft).text).toBe("original draft");
   expect(request).toHaveBeenCalledTimes(1);
   expect(timeout.mock.calls.map(call=>call[0])).toEqual([60_000,8_000]);
   expect(warmupController.signal.aborted).toBe(false);
   finish(response()); await prepare;
   timeout.mockImplementation(ms=>ms===60_000?warmupController.signal:new AbortController().signal);
   request.mockResolvedValue(response());
   expect((await editor.rewrite("Yesterday red, no green flowers.")).text).toBe("Yesterday I bought green flowers.");
  } finally {timeout.mockRestore();}
 });
});
