import {it,expect,vi} from "vitest";
import {NativeDotVoice} from "../src/native-dot-voice.js";
import {BrowserCloudObserver} from "../src/browser-cloud-observer.js";
const id="00000000-0000-4000-8000-000000000001",sdp="v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111";
it("uses the selected cloud browser call and only publishes readiness after its matching answer",async()=>{
 const commands=vi.fn(),delivery=vi.fn(async(_payload:Record<string,unknown>)=>{}),voice=new NativeDotVoice({configuredDot:()=>null,
  nativeVoiceTarget:t=>t===id?{title:"Cloud test"}:null,nativeVoiceAvailable:t=>t===id,voiceCommand:commands},delivery);
 expect(voice.capability(id)).toMatchObject({nativeBrowserVoice:true,nativeDot:false,realtimeApiAvailable:true,task:{id}});
 voice.start("call",id,sdp);expect(commands).toHaveBeenCalledWith(expect.objectContaining({action:"start",threadId:id,sdp}));
 await voice.event({callId:"call",threadId:id,state:"active"});expect(delivery).not.toHaveBeenCalled();
 await voice.event({callId:"call",threadId:id,state:"accepted"});await voice.event({callId:"call",threadId:id,state:"answer",sdp});
 await voice.event({callId:"call",threadId:id,state:"active"});expect(delivery.mock.calls.map(c=>c[0].kind)).toEqual(["live.answer","live.ready"]);
 await voice.stop("call");expect(commands).toHaveBeenLastCalledWith(expect.objectContaining({action:"stop",threadId:id}));
 expect(voice.capability("unobserved").realtimeApiAvailable).toBe(false);
});
it("preserves current cloud voice capability through idle and empty-history snapshots",()=>{
 const snapshot=vi.fn(),o=new BrowserCloudObserver({threadId:id,title:"Cloud test",sendEnabled:true},snapshot,vi.fn());
 const frame={version:1 as const,kind:"observation" as const,url:`https://chatgpt.com/local/${id}`,documentId:id,observedAt:Date.now(),extractionMs:1,
  visibility:"visible" as const,blocked:false,inputReady:true,generationActive:false,nativeVoice:true,turns:[]};
 o.accept(frame);expect(snapshot.mock.calls.at(-1)?.[0]).toMatchObject({status:"idle",nativeVoice:true});
 o.accept({...frame,turns:[{id:"old",reply:"old reply",completed:true,evidence:"response-actions-without-stop" as const}]});
 expect(snapshot.mock.calls.at(-1)?.[0].nativeVoice).toBe(true);
 o.accept({...frame,nativeVoice:false});expect(snapshot.mock.calls.at(-1)?.[0].nativeVoice).toBe(false);
});
