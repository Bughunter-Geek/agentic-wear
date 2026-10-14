import {afterEach,it,expect,vi} from "vitest";
import {CloudVoiceCompanion,CLOUD_VOICE_TOOL,type CompanionHost} from "../src/cloud-voice-companion.js";
import type {ChatSnapshot} from "../src/app-server-client.js";
const offer="v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111";
const settled=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(){
 let snapshot:ChatSnapshot={threadId:"cloud",title:"Selected cloud",status:"idle",cloudModel:"chosen-model",cloudEffort:{index:2,label:"High"},messages:[],paragraphs:[]};
 const host={connect:vi.fn(async()=>{}),capability:vi.fn(async()=>({realtimeApiAvailable:true,voices:{defaultV1:"sol"}})),create:vi.fn(async()=>"private-proxy"),start:vi.fn(async()=>{}),stop:vi.fn(async()=>{}),release:vi.fn(async()=>{}),close:vi.fn(async()=>{})};
 const send=vi.fn(async(thread:string,requestId:string,_text:string)=>({requestId,threadId:thread,outcome:"accepted" as const,nativeTurnId:"new-turn",message:"Posted"}));
 const deliver=vi.fn(async(_payload:Record<string,unknown>)=>{});
 const factory=vi.fn(()=>host as CompanionHost);
 const voice=new CloudVoiceCompanion({owns:t=>t==="cloud",snapshot:()=>snapshot,submitText:send},factory,deliver,Date.now,1000);
 const request=(callId="tool-1",message="Do this in the selected chat")=>({threadId:"private-proxy",callId,turnId:"proxy-turn",tool:CLOUD_VOICE_TOOL,arguments:{message}});
 const reply=(requestId:string,text="Actual cloud reply")=>{snapshot={...snapshot,messages:[{id:"reply",turnId:"new-turn",watchRequestId:requestId,role:"assistant",kind:"message",phase:"final_answer",text,approvalId:null,canControl:false,resolved:true}]};voice.snapshotChanged("cloud");};
 return {voice,host,send,deliver,factory,request,reply,setSnapshot:(s:ChatSnapshot)=>{snapshot=s;},snapshot:()=>snapshot};
}
afterEach(()=>vi.useRealTimers());
it("opens private native WebRTC while preserving the selected cloud's model/effort and task identity",async()=>{
 const f=fixture();expect(await f.voice.capability("cloud")).toMatchObject({cloudCompanion:true,requiresHostReady:false,task:{id:"cloud",model:"chosen-model",effort:"High"}});
 await f.voice.start("watch-call","cloud",offer,"sol");expect(f.host.start).toHaveBeenCalledWith("private-proxy",offer,"sol");expect(f.send).not.toHaveBeenCalled();
 await f.voice.notification("thread/realtime/sdp",{threadId:"other",sdp:offer});expect(f.deliver).not.toHaveBeenCalled();
 await f.voice.notification("thread/realtime/sdp",{threadId:"private-proxy",sdp:offer});expect(f.deliver).toHaveBeenCalledWith({version:1,kind:"live.answer",callId:"watch-call",sdp:offer});
 await f.voice.stop("watch-call");
});
it("sends once with no settings overrides, ignores old/unmatched replies and reads only the matched final answer",async()=>{
 const f=fixture();await f.voice.start("watch-call","cloud",offer,"sol");
 const first=f.voice.tool(f.request()),duplicate=f.voice.tool(f.request());await settled();expect(f.send).toHaveBeenCalledOnce();expect(f.send.mock.calls[0]).toEqual(["cloud",expect.any(String),"Do this in the selected chat"]);
 const id=f.send.mock.calls[0]![1];let done=false;void first.then(()=>{done=true;});
 f.reply("old-request","Old reply");await settled();expect(done).toBe(false);
 f.reply(id);expect(await first).toMatchObject({success:true,contentItems:[{text:"Actual cloud reply"}]});expect(await duplicate).toEqual(await first);await f.voice.stop("watch-call");
});
it("never dispatches stale/foreign tool calls or a changed message under a repeated invocation ID",async()=>{
 const f=fixture();await f.voice.start("watch-call","cloud",offer,"sol");
 expect((await f.voice.tool({...f.request(),threadId:"foreign"})).success).toBe(false);
 const pending=f.voice.tool(f.request());await settled();expect((await f.voice.tool(f.request("tool-1","different"))).success).toBe(false);
 await f.voice.stop("watch-call");expect((await pending).success).toBe(false);expect((await f.voice.tool(f.request("late"))).success).toBe(false);expect(f.send).toHaveBeenCalledOnce();
});
it("an uncertain browser delivery is fenced against duplicate dispatch",async()=>{
 const f=fixture();f.send.mockRejectedValueOnce(new Error("PRIVATE_INTERNAL_DIAGNOSTIC"));await f.voice.start("watch-call","cloud",offer,"sol");
 const a=await f.voice.tool(f.request()),b=await f.voice.tool(f.request("new-tool-id"));expect(a.success).toBe(false);expect(b).toEqual(a);expect(JSON.stringify(a)).not.toContain("PRIVATE_");expect(f.send).toHaveBeenCalledOnce();await f.voice.stop("watch-call");
});
it("cancellation while the hidden session is being created never starts a late native call",async()=>{
 const f=fixture();let created!:(id:string)=>void;f.host.create.mockImplementationOnce(()=>new Promise(resolve=>{created=resolve;}));
 const start=f.voice.start("watch-call","cloud",offer,"sol");const outcome=start.catch(()=>{});await settled();const stop=f.voice.stop("watch-call");created("private-proxy");await stop;await outcome;
 expect(f.host.start).not.toHaveBeenCalled();expect(f.host.stop).not.toHaveBeenCalled();expect(f.host.release).toHaveBeenCalledWith("private-proxy");expect(f.voice.active).toBe(false);
});
it("failed native cleanup resets only the private companion connection",async()=>{
 const f=fixture();await f.voice.start("watch-call","cloud",offer,"sol");f.host.stop.mockRejectedValueOnce(new Error("lost ack"));await f.voice.stop("watch-call");
 expect(f.host.close).toHaveBeenCalledOnce();expect(f.factory).toHaveBeenCalledTimes(2);expect(f.voice.active).toBe(false);expect(f.send).not.toHaveBeenCalled();
});
it("stale stops cannot close a newer call and reply timeout never repeats cloud work",async()=>{
 vi.useFakeTimers();const f=fixture();await f.voice.start("first","cloud",offer,"sol");await f.voice.stop("first");await f.voice.start("second","cloud",offer,"sol");
 const stopped=f.host.stop.mock.calls.length;await f.voice.stop("first");expect(f.host.stop).toHaveBeenCalledTimes(stopped);
 const result=f.voice.tool(f.request());await settled();await vi.advanceTimersByTimeAsync(1001);expect((await result).success).toBe(false);expect(f.send).toHaveBeenCalledOnce();await f.voice.stop("second");
});
it("serializes distinct cloud requests without blocking the ongoing audio call",async()=>{
 const f=fixture();await f.voice.start("watch-call","cloud",offer,"sol");
 const first=f.voice.tool(f.request("one","First question")),second=f.voice.tool(f.request("two","Second question"));await settled();expect(f.send).toHaveBeenCalledOnce();expect(f.voice.active).toBe(true);
 f.reply(f.send.mock.calls[0]![1],"First answer");await first;await settled();expect(f.send).toHaveBeenCalledTimes(2);f.reply(f.send.mock.calls[1]![1],"Second answer");expect((await second).success).toBe(true);await f.voice.stop("watch-call");
});
it("a failed warmup releases only its owned host and an explicit later call can reconnect",async()=>{
 const f=fixture();f.host.connect.mockRejectedValueOnce(new Error("offline"));await expect(f.voice.capability("cloud")).rejects.toThrow("offline");
 expect(f.host.close).toHaveBeenCalledOnce();expect(f.factory).toHaveBeenCalledTimes(2);expect(await f.voice.capability("cloud")).toMatchObject({cloudCompanion:true});expect(f.host.connect).toHaveBeenCalledTimes(2);
});
