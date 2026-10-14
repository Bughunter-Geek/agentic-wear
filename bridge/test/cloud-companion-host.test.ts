import {it,expect,vi} from "vitest";
import {AppServerClient} from "../src/app-server-client.js";
import {CLOUD_VOICE_TOOL} from "../src/cloud-voice-companion.js";
const thread={id:"private-proxy",ephemeral:true,preview:"",updatedAt:1_787_900_000,status:{type:"idle"},parentThreadId:null,agentRole:null};
function fixture(){
 const client=new AppServerClient(new Set(),async()=>{},async()=>{}),request=vi.fn(async(method:string,_params:unknown)=>method==="config/read"?{config:{mcp_servers:{existing_server:{enabled:true}}}}:method==="thread/start"?{thread}:{});
 const internals=client as unknown as {request:typeof request;write:(v:unknown)=>void;handleServerRequest:(id:number,method:string,params:unknown)=>Promise<void>};internals.request=request;internals.write=vi.fn();
 return {client,request,internals};
}
it("creates an ephemeral transport with one scoped tool, disables inherited tools, and never overrides models/settings",async()=>{
 const f=fixture(),history=JSON.stringify({messages:[{role:"user",text:"UNTRUSTED_HISTORY"}]});const id=await f.client.createCloudCompanion("/tmp",history);
 const start=f.request.mock.calls.find(c=>c[0]==="thread/start")![1] as Record<string,unknown>;
 expect(start).toMatchObject({ephemeral:true,sandbox:"read-only",dynamicTools:[{name:CLOUD_VOICE_TOOL}],config:{"mcp_servers.existing_server.enabled":false,"features.shell_tool":false}});
 expect(start).not.toHaveProperty("model");expect(start).not.toHaveProperty("effort");expect(String(start.developerInstructions)).not.toContain("UNTRUSTED_HISTORY");
 await f.client.startCloudCompanion(id,"v=0\r\nm=audio","sol");expect(f.request).toHaveBeenCalledWith("thread/realtime/start",expect.objectContaining({threadId:id,version:"v3",initialItems:[{role:"user",text:"UNTRUSTED_HISTORY"}],transport:{type:"webrtc",sdp:"v=0\r\nm=audio"}}));
 await f.client.releaseCloudCompanion(id);expect(f.request).toHaveBeenLastCalledWith("thread/unsubscribe",{threadId:id});
 expect(f.request.mock.calls.some(c=>["thread/settings/update","turn/start","thread/resume"].includes(c[0]))).toBe(false);
});
it("answers dynamic tool RPCs only for a companion it created",async()=>{
 const f=fixture(),handler=vi.fn(async()=>({success:true,contentItems:[{type:"inputText",text:"Cloud answer"}]}));f.client.setCloudCompanionTools(handler);
 await f.client.createCloudCompanion("/tmp",JSON.stringify({messages:[]}));
 await f.internals.handleServerRequest(1,"item/tool/call",{threadId:"other",tool:CLOUD_VOICE_TOOL});expect(handler).not.toHaveBeenCalled();
 await f.internals.handleServerRequest(2,"item/tool/call",{threadId:"private-proxy",tool:CLOUD_VOICE_TOOL});expect(handler).toHaveBeenCalledOnce();
 expect(f.internals.write).toHaveBeenLastCalledWith({id:2,result:{success:true,contentItems:[{type:"inputText",text:"Cloud answer"}]}});
});

it("refuses to pass cloud context to a different inherited model provider",async()=>{
 const f=fixture();f.request.mockImplementationOnce(async()=>({config:{model_provider:"other-provider"}} as never));
 await expect(f.client.createCloudCompanion("/tmp",JSON.stringify({messages:[]}))).rejects.toThrow("No cloud context was sent");expect(f.request).toHaveBeenCalledTimes(1);
});
