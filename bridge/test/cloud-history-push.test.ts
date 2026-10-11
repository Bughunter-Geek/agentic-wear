import {describe,it,expect} from "vitest";
import {cloudHistoryPayloads} from "../src/cloud-history-push.js";
import {CryptoBox,generateBridgeKeyPair} from "../src/crypto-box.js";
import type {ChatSnapshot} from "../src/app-server-client.js";
function snapshot(text="hello"):ChatSnapshot{return {threadId:"dot:lumen",title:"Lumen · Dot",status:"idle",paragraphs:[],
 messages:Array.from({length:20},(_,i)=>({id:`browser:message-${i}`,turnId:`turn-${Math.floor(i/2)}`,role:i%2?"assistant":"user",kind:"message",text,
 phase:i%2?"final_answer":"unknown",approvalId:null,canControl:false,resolved:true}))};}
describe("cloud history delivery",()=>{
 it("sends the newest twelve, preserving the newest prompt/reply and original text",()=>{
  const source=snapshot(),{full,inline}=cloudHistoryPayloads(source,123,"request-1");
  expect(full.messages).toHaveLength(12);expect(full.messages[0]?.id).toBe("browser:message-8");
  expect(inline.messages.slice(-2)).toEqual(source.messages.slice(-2));
  expect(full.paragraphs).toEqual([]);expect(inline.generatedAt).toBe(full.generatedAt);
 });
 it("marks only a trimmed inline snapshot as partial",()=>{
  const small={...snapshot(),messages:snapshot().messages.slice(-2)};
  const a=cloudHistoryPayloads(small,1);expect(a.inline).not.toHaveProperty("partial");expect(a.full).not.toHaveProperty("partial");
  const dropped=cloudHistoryPayloads(snapshot("x".repeat(300)),1);
  expect(dropped.inline.messages.length).toBeLessThan(dropped.full.messages.length);expect(dropped.inline.partial).toBe(true);expect(dropped.full).not.toHaveProperty("partial");
  const shortened=cloudHistoryPayloads({...snapshot(),messages:[{...snapshot().messages[0]!,text:"y".repeat(4000)}]},1);
  expect(shortened.inline.messages[0]!.text).not.toBe("y".repeat(4000));expect(shortened.inline.partial).toBe(true);
 });
 it("fits real encrypted FCM envelopes including multibyte long replies, without altering full history",async()=>{
  const a=await generateBridgeKeyPair(),b=await generateBridgeKeyPair();
  const box=new CryptoBox("pair-test",a.privateKeyMaterial,a.publicKeyBase64,b.publicKeyBase64);
  for(const text of ["short reply","🥹\"\\\n".repeat(650)]){
   const source=snapshot(text),{full,inline}=cloudHistoryPayloads(source,Date.now(),"r".repeat(128));
   const wire=await box.encrypt(inline);
   expect(JSON.stringify(wire).length).toBeLessThanOrEqual(3000);
   expect(inline.messages.at(-1)?.id).toBe("browser:message-19");
   expect(inline.messages.at(-2)?.turnId).toBe(inline.messages.at(-1)?.turnId);
   expect(full.messages.at(-1)?.text).toBe(text);expect(source.messages.at(-1)?.text).toBe(text);
  }
 });
});
