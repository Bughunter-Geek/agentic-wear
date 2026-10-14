import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {it} from 'node:test';
import assert from 'node:assert/strict';
const script=readFileSync(new URL('../../browser-receiver/extension/content.js',import.meta.url),'utf8');
async function observe(button=''){
 const dom=new JSDOM(`<main><div data-turn-key="history-content:turn:00000000-0000-4000-8000-000000000002">Old unfinished turn</div><div class="ProseMirror" contenteditable="true" data-codex-composer="true"></div>${button}</main>`,{url:'https://chatgpt.com/local/00000000-0000-4000-8000-000000000001',runScripts:'outside-only'}),rows=[];
 try{Object.defineProperty(dom.window.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});dom.window.chrome={runtime:{id:'ext',sendMessage:async x=>rows.push(x)}};dom.window.setInterval=()=>1;dom.window.eval(script);await new Promise(r=>setImmediate(r));return rows.at(-1);}finally{dom.window.close();}
}
it('an unfinished historical row is not current generation',async()=>{const r=await observe();assert.equal(r.generationActive,false);assert.equal(r.inputReady,true);assert.equal(r.turns[0].completed,false);});
it('a visible enabled Stop control proves current generation',async()=>{const r=await observe('<button aria-label="Stop generating"></button>');assert.equal(r.generationActive,true);assert.equal(r.inputReady,false);});
it('hidden or disabled Stop controls do not keep a cloud chat working',async()=>{const r=await observe('<div hidden><button aria-label="Stop generating"></button></div><button aria-label="Stop response" disabled></button>');assert.equal(r.generationActive,false);assert.equal(r.inputReady,true);});
