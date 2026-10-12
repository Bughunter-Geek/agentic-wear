import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {it} from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../../browser-receiver/extension/worker.js',import.meta.url),'utf8');
const uuid='01a1188b-a850-755b-91ec-717f6182900a';
function load(tabs){
 const hooks={installed:[],startup:[],updated:[],message:[]},injected=[],posted=[];
 const ev=list=>({addListener:f=>list.push(f)});
 const chrome={runtime:{id:'ext',onInstalled:ev(hooks.installed),onStartup:ev(hooks.startup),onMessage:ev(hooks.message),
   connectNative:()=>({postMessage:m=>posted.push(m),onDisconnect:{addListener(){}},onMessage:{addListener(){}}})},
  action:{setBadgeText(){}},
  tabs:{onRemoved:ev([]),onUpdated:ev(hooks.updated),query:async()=>tabs,get:async id=>tabs.find(tab=>tab.id===id),update:async()=>{},sendMessage:async()=>{}},
  scripting:{executeScript:async o=>{injected.push(o);}}};
 vm.runInNewContext(source,{chrome,JSON,Date,Map,Set,Promise});
 return {hooks,injected,posted};
}
it('re-attaches content.js to open chat tabs on install and startup, only for matching URLs',async()=>{
 const w=load([{id:1,url:`https://chatgpt.com/local/${uuid}`},{id:2,url:'https://chatgpt.com/dots/home'},{id:3,url:`https://chatgpt.com/c/${uuid}`},{id:4,url:`https://chatgpt.com/local/${uuid}?x=1`}]);
 for(const f of w.hooks.installed)f();await new Promise(r=>setTimeout(r,5));
 assert.deepEqual(w.injected.map(o=>o.target.tabId),[2,1,2]);
 assert.equal(JSON.stringify(w.injected[0].files),'["remote-peer.js","voice-hook.js"]');
 assert.equal(w.injected[0].world,'MAIN');
 assert.equal(JSON.stringify(w.injected[1].files),'["voice-controller.js","content.js"]');
 for(const f of w.hooks.startup)f();await new Promise(r=>setTimeout(r,5));
 assert.equal(w.injected.length,6);
});
it('injects on in-page navigation to a chat and accepts observations only from valid chat URLs',async()=>{
 const w=load([{id:9,url:`https://chatgpt.com/local/${uuid}`}]);
 w.hooks.updated[0](9,{url:`https://chatgpt.com/local/${uuid}`});w.hooks.updated[0](9,{url:`https://chatgpt.com/c/${uuid}`});
 await new Promise(r=>setTimeout(r,5));assert.deepEqual(w.injected.map(o=>o.target.tabId),[9]);
 const obs=url=>({version:1,kind:'observation',url,documentId:'d',turns:[]});
 const send=(url,m)=>w.hooks.message[0](m,{id:'ext',frameId:0,url,tab:{id:5}});
 send(`https://chatgpt.com/local/${uuid}`,obs(`https://chatgpt.com/local/${uuid}`));
 send(`https://chatgpt.com/c/${uuid}`,obs(`https://chatgpt.com/c/${uuid}`));
 assert.equal(w.posted.length,1);
});
