import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {it} from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../../browser-receiver/extension/worker.js',import.meta.url),'utf8');
const uuid='01a1188b-a850-755b-91ec-717f6182900a';
function load(tabs){
 const hooks={installed:[],startup:[],updated:[],message:[],native:[]},injected=[],posted=[];
 const ev=list=>({addListener:f=>list.push(f)});
 const chrome={runtime:{id:'ext',onInstalled:ev(hooks.installed),onStartup:ev(hooks.startup),onMessage:ev(hooks.message),
   connectNative:()=>({postMessage:m=>posted.push(m),onDisconnect:{addListener(){}},onMessage:ev(hooks.native)})},
  action:{setBadgeText(){}},
  tabs:{onRemoved:ev([]),onUpdated:ev(hooks.updated),query:async()=>tabs,get:async id=>tabs.find(tab=>tab.id===id),update:async()=>{},sendMessage:async()=>{}},
  scripting:{executeScript:async o=>{injected.push(o);}}};
 vm.runInNewContext(source,{chrome,JSON,Date,Map,Set,Promise});
 return {hooks,injected,posted,chrome};
}
it('re-attaches content.js to open chat tabs on install and startup, only for matching URLs',async()=>{
 const w=load([{id:1,url:`https://chatgpt.com/local/${uuid}`},{id:2,url:'https://chatgpt.com/dots/home'},{id:3,url:`https://chatgpt.com/c/${uuid}`},{id:4,url:`https://chatgpt.com/local/${uuid}?x=1`}]);
 for(const f of w.hooks.installed)f();await new Promise(r=>setTimeout(r,5));
 assert.deepEqual(w.injected.map(o=>o.target.tabId),[1,2,1,2]);
 assert.equal(JSON.stringify(w.injected[0].files),'["remote-peer.js","voice-timing.js","native-allocation.js","voice-hook.js"]');
 assert.equal(w.injected[0].world,'MAIN');
 assert.equal(JSON.stringify(w.injected[2].files),'["voice-controller.js","content.js"]');
 for(const f of w.hooks.startup)f();await new Promise(r=>setTimeout(r,5));
 assert.equal(w.injected.length,8);
});
it('injects on in-page navigation to a chat and accepts observations only from valid chat URLs',async()=>{
 const w=load([{id:9,url:`https://chatgpt.com/local/${uuid}`}]);
 w.hooks.updated[0](9,{url:`https://chatgpt.com/local/${uuid}`});w.hooks.updated[0](9,{url:`https://chatgpt.com/c/${uuid}`});
 await new Promise(r=>setTimeout(r,5));assert.deepEqual(w.injected.map(o=>o.target.tabId),[9,9]);
 const obs=url=>({version:1,kind:'observation',url,documentId:'d',turns:[]});
 const send=(url,m)=>w.hooks.message[0](m,{id:'ext',frameId:0,url,tab:{id:5}});
 send(`https://chatgpt.com/local/${uuid}`,obs(`https://chatgpt.com/local/${uuid}`));
 send(`https://chatgpt.com/c/${uuid}`,obs(`https://chatgpt.com/c/${uuid}`));
 assert.equal(w.posted.length,1);
});

const dot='https://chatgpt.com/dots/home';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function voiceFixture(){
 const w=load([{id:2,url:dot}]); let muted=false; const updates=[];
 w.chrome.tabs.get=async()=>({id:2,mutedInfo:{muted,reason:muted?'extension':'user',extensionId:'ext'}});
 w.chrome.tabs.update=async(id,change)=>{if(change.muted!==undefined){muted=change.muted;updates.push(muted);}};
 w.chrome.tabs.sendMessage=async(id,command)=>command.kind==='native-voice-check'?{ready:true}:true;
 const sender={id:'ext',frameId:0,url:dot,tab:{id:2}};
 w.hooks.message[0]({version:1,kind:'observation',url:dot,documentId:'d',identity:'lumen',turns:[]},sender);
 return {...w,updates,sender,muted:()=>muted,
  start(callId){w.hooks.native[0]({kind:'native-voice',action:'start',callId,threadId:'dot',documentId:'d',url:dot,expiresAt:Date.now()+30000});},
  close(callId){w.hooks.message[0]({version:1,kind:'native-voice-event',url:dot,documentId:'d',identity:'lumen',event:{callId,state:'closed'}},sender);}};
}
it('a previous-call mute restoration cannot unmute a newly starting Watch call',async()=>{
 const w=voiceFixture();w.start('first');await settle();assert.equal(w.muted(),true);
 const get=w.chrome.tabs.get;let release, reads=0;
 w.chrome.tabs.get=async()=>{reads++;const tab=await get();if(reads===1)await new Promise(resolve=>release=resolve);return tab;};
 w.close('first');await settle();w.start('second');await settle();
 release();await settle();await settle();
 assert.equal(w.muted(),true,'the second Watch call must keep all browser call audio muted');
 w.close('second');await settle();assert.equal(w.muted(),false,'the original unmuted state must be restored');
});

it('overlapping mute leases preserve the original user setting until the last call closes',async()=>{
 for(const originalMuted of [false,true]){
  const w=voiceFixture();if(originalMuted)await w.chrome.tabs.update(2,{muted:true});
  w.start('first');await settle();w.start('second');await settle();
  w.close('first');await settle();assert.equal(w.muted(),true);
  w.close('second');await settle();assert.equal(w.muted(),originalMuted);
 }
});
it('a rejected second start cannot release the first call’s mute lease',async()=>{
 const w=voiceFixture();w.start('first');await settle();
 w.chrome.tabs.sendMessage=async(id,command)=>command.kind==='native-voice-check'?{ready:true}:false;
 w.start('second');await settle();await settle();assert.equal(w.muted(),true);
 w.close('first');await settle();assert.equal(w.muted(),false);
});
it('restoration respects a user-owned mute change made during the Watch call',async()=>{
 const w=voiceFixture();w.start('first');await settle();
 w.chrome.tabs.get=async()=>({id:2,mutedInfo:{muted:true,reason:'user'}});
 w.close('first');await settle();assert.equal(w.muted(),true);
});

it('cloud voice commands and events stay bound to the observed cloud document and mute lease',async()=>{
 const url=`https://chatgpt.com/local/${uuid}`,w=load([{id:3,url}]);let muted=false;const sent=[];
 w.chrome.tabs.get=async()=>({id:3,url,mutedInfo:{muted,reason:muted?'extension':'user',extensionId:'ext'}});
 w.chrome.tabs.update=async(id,change)=>{if(change.muted!==undefined)muted=change.muted;};
 w.chrome.tabs.sendMessage=async(id,command)=>{sent.push({id,command});return command.kind==='native-voice-check'?{ready:true}:true;};
 const sender={id:'ext',frameId:0,url,tab:{id:3}};
 w.hooks.message[0]({version:1,kind:'observation',url,documentId:'cloud-doc',identity:url,turns:[]},sender);
 w.hooks.native[0]({kind:'native-voice',action:'start',callId:'cloud',threadId:uuid,documentId:'cloud-doc',url,expiresAt:Date.now()+30000});
 await settle();await settle();assert.equal(muted,true);assert.equal(sent.at(-1).id,3);
 const event={version:1,kind:'native-voice-event',url,documentId:'cloud-doc',identity:url,event:{callId:'cloud',threadId:uuid,state:'closed'}};
 const count=w.posted.length;w.hooks.message[0]({...event,documentId:'foreign'},sender);assert.equal(w.posted.length,count);
 w.hooks.message[0](event,sender);await settle();await settle();assert.equal(muted,false);
});
