import type { ChatSnapshot } from "./app-server-client.js";

// Wear's decoder reads the FIRST twelve messages. Select the newest window
// here, before serialization, or replies after message twelve disappear.
const MAX_MESSAGES=12;
const INLINE_BYTES=1900; // AES-GCM/base64 plus envelope stays below FCM's 3000 chars.
export function cloudHistoryPayloads(snapshot:ChatSnapshot,generatedAt:number,requestId?:string) {
  const full={version:1 as const,kind:"chat.snapshot",requestId,...snapshot,
    paragraphs:[],messages:snapshot.messages.slice(-MAX_MESSAGES),generatedAt};
  const inline={...full,messages:full.messages.map(m=>({...m}))};
  const size=()=>Buffer.byteLength(JSON.stringify(inline),"utf8");
  // Preserve the latest prompt/reply together. Retain more history whenever it
  // fits; normal inbox delivery supplies the complete twelve-message window.
  while(size()>INLINE_BYTES && inline.messages.length>2)inline.messages.shift();
  const suffix="\n[…continues on desktop]";
  while(size()>INLINE_BYTES){
    const longest=inline.messages.reduce((a,b)=>a.text.length>b.text.length?a:b);
    const original=longest.text.endsWith(suffix)?longest.text.slice(0,-suffix.length):longest.text;
    if(original.length<=16)throw new Error("Cloud history metadata exceeds the push budget");
    longest.text=Array.from(original).slice(0,Math.max(8,Math.floor(Array.from(original).length*0.75))).join("")+suffix;
  }
  return {full,inline};
}
