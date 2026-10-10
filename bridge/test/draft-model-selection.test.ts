import {afterEach,describe,expect,it,vi} from "vitest";
import {LocalDraftEditor} from "../src/draft-editor.js";

afterEach(()=>vi.unstubAllEnvs());
const response=()=>new Response(JSON.stringify({done:true,done_reason:"stop",message:{content:JSON.stringify({draft:"Hello Alex. Do not delete the folder. Keep 12 files."})}}));
describe("application-scoped voice editor model selection",()=>{
 it("prepares and edits with the same selected model and preserves quality/residency settings",async()=>{
  const model="qwen3:4b-instruct-2507-q4_K_M";
  vi.stubEnv("AGENTIC_WEAR_DRAFT_MODEL",` ${model} `);
  const request=vi.fn<typeof fetch>().mockImplementation(async()=>response());
  const editor=new LocalDraftEditor(request);
  await editor.prepare();
  // Selection is fixed for an editor instance: a warmup cannot prepare a different model.
  vi.stubEnv("AGENTIC_WEAR_DRAFT_MODEL","llama3.1:latest");
  const result=await editor.rewrite("Please add Hello Alex at the beginning.","Do not delete the folder. Keep 12 files.");
  expect(result.outcome).toBe("accepted");expect(result.text).toContain("Do not delete the folder");
  expect(request).toHaveBeenCalledTimes(2);
  const bodies=request.mock.calls.map(call=>JSON.parse(call[1]!.body as string) as {model:string;keep_alive:number;options:{temperature:number;num_ctx:number;num_predict:number};messages:{content:string}[];tools?:unknown});
  for(const body of bodies){expect(body.model).toBe(model);expect(body.keep_alive).toBe(-1);expect(body.tools).toBeUndefined();}
  expect(bodies[0]?.options).toEqual({temperature:0,num_ctx:2048,num_predict:1});
  expect(bodies[1]?.options).toEqual({temperature:0,num_ctx:2048,num_predict:512});
  expect(bodies[0]?.messages[0]?.content).toContain("Preserve the original object noun");
  expect(bodies[1]?.messages[0]?.content).not.toContain("Replace only the smallest changed value");
 });
 it.each([undefined,"","   "])("keeps the Llama rollback/default for absent or blank selection %s",async value=>{
  vi.stubEnv("AGENTIC_WEAR_DRAFT_MODEL",value);
  const request=vi.fn<typeof fetch>().mockImplementation(async()=>response());
  await new LocalDraftEditor(request).prepare();
  expect(JSON.parse(request.mock.calls[0]![1]!.body as string).model).toBe("llama3.1:latest");
 });
});
