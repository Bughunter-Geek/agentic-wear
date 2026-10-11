import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
const script=readFileSync(new URL('../../browser-receiver/extension/content.js',import.meta.url),'utf8');
const url='https://chatgpt.com/local/01a1188b-a850-755b-91ec-717f6182900a';
const dotUrl='https://chatgpt.com/dots/home',ns='fa24ed5a57dc8199b97f68f7d0098d11';
const MODELS=['GPT-6.1 Sol','GPT-6 Astra','GPT-6 Sol','Daybreak Blue'],LABELS=['Minimal','Low','Medium','High','Max'];
const tick=ms=>new Promise(r=>setTimeout(r,ms));
// A fake Radix-like model menu built from the structure observed on the real page.
function harness({hidden=false,focused=true,interact=false,dot=false,stuck=false,buttonStuck=false,model='GPT-6.1 Sol',effort=2}={}){
 const state={model,effort,opens:0,clicks:0,sliderKeys:[]};
 const composerHtml=dot?'<div class="ProseMirror" contenteditable="true" aria-label="Message"></div>':'<div class="ProseMirror" contenteditable="true" data-codex-composer="true"></div>';
 const dotRow=(id,role,text)=>`<article class="message-row ${role==='user'?'self':''}" data-message-id="${ns}~${ns}~CalpicoMessage~Sentinel_${id}"><div class="message-body">${text}<div class="message-inline-actions"><button data-action="reply">Reply</button></div></div></article>`;
 const pre=dot?`<button data-orbit-profile-trigger="true" aria-label="Open Lumen’s profile"></button>${dotRow('a'.repeat(32),'assistant','hello')}`:'';
 const dom=new JSDOM(`<main>${pre}${composerHtml}<button aria-label="Send">Send</button><button aria-haspopup="menu" id="mb"></button></main>`,{url:dot?dotUrl:url,runScripts:'outside-only'});
 const w=dom.window,d=w.document,seen=[];let listener;
 Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
 if(hidden)Object.defineProperty(d,'visibilityState',{get:()=>'hidden'});
 d.hasFocus=()=>focused;
 let skew=0;const realNow=w.Date.now.bind(w.Date);w.Date.now=()=>realNow()+skew;
 w.chrome={runtime:{id:'ext',sendMessage:x=>{seen.push(JSON.parse(JSON.stringify(x)));return Promise.resolve();},onMessage:{addListener:x=>{listener=x;},removeListener(){}}}};
 d.execCommand=(_n,_u,t)=>{d.querySelector('.ProseMirror').textContent=t;return true;};
 const button=d.getElementById('mb');
 const paint=()=>{button.textContent=buttonStuck?`${MODELS[0]} ${LABELS[2]}`:`${state.model} ${LABELS[state.effort]}`;};paint();
 const menu=()=>d.querySelector('[role=menu]');
 const close=()=>{menu()?.remove();};
 const open=()=>{
  if(menu())return;state.opens++;
  const m=d.createElement('div');m.setAttribute('role','menu');m.dataset.state='open';
  const radios=MODELS.map(n=>`<div role="menuitemradio" aria-checked="${n===state.model}" ${n===state.model?'data-model-selected="true"':''}>${n}</div>`).join('');
  m.innerHTML=`<div role="menuitem" aria-label="Select model" data-model-picker-view-toggle="true">${state.model}${LABELS[state.effort]}</div>
   <div role="menuitemcheckbox" aria-label="Enable fast mode" aria-checked="false"></div><div role="menuitem" aria-label="Reset to default"></div>
   <span role="status">${state.model} ${state.effort===1?'Standard':LABELS[state.effort]}, ${state.effort+1} of 5.</span>
   <div role="menuitem" data-reasoning-slider="true"><span role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="4" aria-valuenow="${state.effort}"></span></div>
   <div role="menuitemradio" aria-checked="false">Default (Recommended)</div>${radios}`;
  d.body.append(m);
  for(const r of m.querySelectorAll('[role=menuitemradio]'))r.addEventListener('click',()=>{const n=r.textContent;if(MODELS.includes(n)){state.model=n;paint();close();}});
  const slider=m.querySelector('[role=slider]');
  slider.addEventListener('keydown',e=>{
   state.sliderKeys.push(e.key);if(stuck)return;
   if(e.key==='ArrowRight')state.effort=Math.min(4,state.effort+1);else if(e.key==='ArrowLeft')state.effort=Math.max(0,state.effort-1);else if(e.key==='Home')state.effort=0;
   slider.setAttribute('aria-valuenow',String(state.effort));paint();
  });
 };
 button.addEventListener('pointerdown',open);
 d.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
 d.querySelector('[aria-label=Send]').onclick=()=>{
  state.clicks++;const editor=d.querySelector('.ProseMirror'),text=editor.textContent;editor.textContent='';
  const main=d.querySelector('main');
  if(dot){main.insertAdjacentHTML('beforeend',dotRow('b'.repeat(32),'user',text));}
  else{const t=d.createElement('div');t.dataset.turnKey=`history-content:turn:01a1188b-a850-755b-91ec-71790000000${state.clicks}`;const b=d.createElement('div');b.dataset.userMessageBubble='true';b.textContent=text;t.append(b);main.prepend(t);}
 };
 w.eval(script);
 if(interact)d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'a',bubbles:true}));
 return {skewTime:ms=>{skew+=ms;},w,d,state,seen,last:()=>seen.at(-1),menuOpen:()=>Boolean(menu()),editorText:()=>d.querySelector('.ProseMirror').textContent,
  send:async changes=>{await tick(30);return new Promise(resolve=>listener({kind:'send',requestId:'req',threadId:'cloud',url:dot?dotUrl:url,documentId:seen.at(-1).documentId,text:'Hello',expiresAt:Date.now()+6000,...changes},{id:'ext'},resolve));},
  stop:()=>w.close()};
}
describe('cloud model and reasoning selection',()=>{
 it('reads the current model and effort from the composer button without opening the menu',async()=>{
  const h=harness();try{await tick(120);
   assert.equal(h.last().model,'GPT-6.1 Sol');assert.equal(h.last().effort.label,'Medium');
   assert.equal(h.state.opens,0);
  }finally{h.stop();}
 });
 it('learns models, effort range and index once while hidden, changing nothing',async()=>{
  const h=harness({hidden:true});try{await tick(900);
   assert.equal(h.state.opens,1);assert.equal(h.menuOpen(),false);
   assert.equal(h.state.model,'GPT-6.1 Sol');assert.equal(h.state.effort,2);assert.deepEqual(h.state.sliderKeys,[]);
   const o=h.last();
   assert.deepEqual(o.models,MODELS);assert.equal(o.efforts.length,5);assert.equal(o.effort.max,4);assert.equal(o.effort.index,2);assert.equal(o.effort.label,'Medium');
   assert.equal(o.inputReady,true);
   await tick(1300);assert.equal(h.state.opens,1);
  }finally{h.stop();}
 });
 it('never opens the menu to learn while the page is visible and focused',async()=>{
  const h=harness();try{await tick(1200);assert.equal(h.state.opens,0);}finally{h.stop();}
 });
 it('learns from a visible page that is not focused (background window), read-only',async()=>{
  const h=harness({focused:false});try{await tick(900);
   assert.equal(h.state.opens,1);assert.equal(h.menuOpen(),false);assert.deepEqual(h.state.sliderKeys,[]);assert.equal(h.state.effort,2);
   assert.deepEqual(h.last().models,MODELS);
  }finally{h.stop();}
 });
 it('waits while the user interacted in the last 10 seconds',async()=>{
  const h=harness({focused:false,interact:true});try{await tick(1300);assert.equal(h.state.opens,0);
   h.skewTime(11000);await tick(1300);assert.equal(h.state.opens,1);
  }finally{h.stop();}
 });
 it('does not learn while the user already has the menu open',async()=>{
  const h=harness({focused:false});try{h.d.getElementById('mb').dispatchEvent(new h.w.MouseEvent('pointerdown',{bubbles:true}));
   await tick(1300);assert.equal(h.state.opens,1);assert.equal(h.menuOpen(),true);
  }finally{h.stop();}
 });
 it('refreshes at most every 30 minutes',async()=>{
  const h=harness({hidden:true});try{await tick(900);assert.equal(h.state.opens,1);
   h.skewTime(29*60*1000);await tick(1300);assert.equal(h.state.opens,1);
   h.skewTime(2*60*1000);await tick(1300);assert.equal(h.state.opens,2);assert.equal(h.menuOpen(),false);
  }finally{h.stop();}
 });
 it('applies model and effort, verifies them, then sends once',async()=>{
  const h=harness();try{
   const r=await h.send({model:'GPT-6 Astra',effortIndex:4});
   assert.equal(r.outcome,'accepted',r.message);assert.equal(h.state.model,'GPT-6 Astra');assert.equal(h.state.effort,4);
   assert.equal(h.state.clicks,1);assert.equal(h.menuOpen(),false);
  }finally{h.stop();}
 });
 it('only changes the effort when the model already matches, and changes nothing when already matching',async()=>{
  const h=harness();try{
   assert.equal((await h.send({model:'GPT-6.1 Sol',effortIndex:2,requestId:'a'})).outcome,'accepted');
   // The effort index is unknown until learned, so the menu is read once; nothing is changed.
   assert.equal(h.state.effort,2);assert.deepEqual(h.state.sliderKeys,[]);
   h.state.opens=0;
   assert.equal((await h.send({effortIndex:0,requestId:'b'})).outcome,'accepted');
   assert.equal(h.state.effort,0);assert.equal(h.state.model,'GPT-6.1 Sol');
  }finally{h.stop();}
 });
 it('rejects without typing when the reasoning slider does not move',async()=>{
  const h=harness({stuck:true});try{
   const r=await h.send({effortIndex:4});
   assert.equal(r.outcome,'rejected');assert.match(r.message,/nothing was sent/);
   assert.equal(h.state.clicks,0);assert.equal(h.editorText(),'');assert.equal(h.menuOpen(),false);
  }finally{h.stop();}
 });
 it('rejects without typing when the composer button does not show the new model',async()=>{
  const h=harness({buttonStuck:true});try{
   const r=await h.send({model:'GPT-6 Sol'});
   assert.equal(r.outcome,'rejected');assert.equal(h.state.clicks,0);assert.equal(h.editorText(),'');assert.equal(h.menuOpen(),false);
  }finally{h.stop();}
 });
 it('rejects a model the page does not offer and an out-of-range effort',async()=>{
  const h=harness();try{
   assert.equal((await h.send({model:'GPT-9 Nope'})).outcome,'rejected');
   assert.equal((await h.send({effortIndex:7,requestId:'x'})).outcome,'rejected');
   assert.equal(h.state.clicks,0);assert.equal(h.state.model,'GPT-6.1 Sol');assert.equal(h.state.effort,2);
  }finally{h.stop();}
 });
 it('Dot never reports, learns or applies a model selection',async()=>{
  const h=harness({dot:true,hidden:true});try{
   await tick(300);assert.equal('model' in h.last(),false);assert.equal('models' in h.last(),false);assert.equal(h.state.opens,0);
   const r=await h.send({model:'GPT-6 Astra',effortIndex:4});
   assert.equal(r.outcome,'accepted',r.message);assert.equal(h.state.opens,0);assert.equal(h.state.model,'GPT-6.1 Sol');
  }finally{h.stop();}
 });
});
