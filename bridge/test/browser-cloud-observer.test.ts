import {describe,it,expect,vi} from 'vitest';
import {BrowserCloudObserver, browserObservationSchema, type BrowserObservation} from '../src/browser-cloud-observer.js';
const threadId='01a1188b-a850-755b-91ec-717f6182900a',old='01a1232b-20a8-7037-a8ac-70b3428de53a',next='01a1280c-97b1-7b83-8544-1db158651c55';
function observation(turns:BrowserObservation['turns']):BrowserObservation{return {version:1,kind:'observation',url:`https://chatgpt.com/local/${threadId}`,documentId:'01a1188b-a850-755b-91ec-717f6182900a',observedAt:Date.now(),extractionMs:1,visibility:'hidden',blocked:false,turns};}
const done=(id:string)=>({id,reply:'CLOUD WATCH TEST',completed:true,evidence:'response-actions-without-stop' as const});
describe('browser cloud provenance and baseline',()=>{
 it('does not replay historical replies that hydrate after the first observation',()=>{
  const terminal=vi.fn(),o=new BrowserCloudObserver({threadId,title:'Cloud'},vi.fn(),terminal);
  o.accept(observation([{id:old,reply:'',completed:false,evidence:null}]));
  o.accept(observation([done(old)]));expect(terminal).not.toHaveBeenCalled();
 });
 it('suppresses history, detects an observed pending turn completing, and deduplicates',()=>{
  const snapshot=vi.fn(),terminal=vi.fn(),o=new BrowserCloudObserver({threadId,title:'Cloud'},snapshot,terminal);
  o.accept(observation([]));o.accept(observation([done(old)]));expect(terminal).not.toHaveBeenCalled();
  o.accept(observation([done(old),{id:next,reply:'',completed:false,evidence:null}]));
  o.accept(observation([done(old),done(next)]));o.accept(observation([done(old),done(next)]));
  expect(terminal).toHaveBeenCalledTimes(1);expect(terminal.mock.calls[0]?.[0]).toMatchObject({turnId:next,source:'browser-ui',nativeCompletedAt:null});
  expect(snapshot.mock.calls.at(-1)?.[0].messages.at(-1)).toMatchObject({text:'CLOUD WATCH TEST',turnId:next});
 });
 it('does not infer completion from quiet time or new historical nodes; rebaselines reload/account loss',()=>{
  const terminal=vi.fn(),o=new BrowserCloudObserver({threadId,title:'Cloud'},vi.fn(),terminal);
  o.accept(observation([done(old)]));o.accept(observation([done(old),done(next)]));expect(terminal).not.toHaveBeenCalled();
  o.accept(observation([{id:next,reply:'',completed:false,evidence:null}]));
  o.accept({...observation([done(next)]),documentId:'01a12312-82d0-7431-99c1-fc53a9a36d83'});expect(terminal).not.toHaveBeenCalled();
  o.accept({...observation([]),blocked:true});o.accept(observation([done(next)]));expect(terminal).not.toHaveBeenCalled();
 });
 it('keeps cloud prompts in order and receives only new Dot messages for the pinned identity',()=>{
  const snapshot=vi.fn(),terminal=vi.fn(),o=new BrowserCloudObserver({threadId,title:'Cloud'},snapshot,terminal);
  o.accept(observation([{...done(old),prompts:[{id:'prompt-1',text:'From Watch or Dot'}]}]));
  expect(snapshot.mock.calls.at(-1)?.[0].messages.map((m:{role:string})=>m.role)).toEqual(['user','assistant']);
  const dot=new BrowserCloudObserver({threadId:'dot:lumen',title:'Lumen',url:'https://chatgpt.com/dots/home',dotNamespace:'abc',sendEnabled:true},snapshot,terminal);
  const d={...observation([{...done(old),role:'user' as const}]),url:'https://chatgpt.com/dots/home',identity:'abc',inputReady:true};
  dot.accept(d);dot.accept({...d,turns:[...d.turns,{...done(next),role:'assistant'}]});
  expect(terminal).toHaveBeenCalledOnce();expect(snapshot.mock.calls.at(-1)?.[0].inputReady).toBe(true);
  dot.accept({...d,documentId:next,turns:[done(old),done(next)]});expect(terminal).toHaveBeenCalledOnce();
  expect(()=>dot.accept({...d,identity:'other'})).toThrow('Wrong Dot');
 });
 it('links Dot replies to their preceding prompt, carries the Watch receipt, and caches history before completion',()=>{
  const order:string[]=[],snapshot=vi.fn((_:unknown)=>{order.push('snapshot');}),terminal=vi.fn((_:unknown)=>{order.push('terminal');});
  const dot=new BrowserCloudObserver({threadId:'dot:lumen',title:'Lumen',url:'https://chatgpt.com/dots/home',dotNamespace:'abc'},snapshot,terminal);
  dot.linkRequest(old,'watch-request');
  const base={...observation([{...done(old),role:'user' as const}]),url:'https://chatgpt.com/dots/home',identity:'abc'};
  dot.accept(base);dot.accept({...base,turns:[...base.turns,{...done(next),role:'assistant'}]});
  const messages=(snapshot.mock.calls.at(-1)?.[0] as import('../src/desktop-cloud-protocol.js').CloudSnapshot).messages;
  expect(messages[0]).toMatchObject({turnId:old,watchRequestId:'watch-request'});
  expect(messages[1]).toMatchObject({turnId:old,phase:'final_answer'});
  expect(terminal.mock.calls.at(-1)?.[0]).toMatchObject({turnId:next,requestId:'watch-request'});
  expect(order.slice(-2)).toEqual(['snapshot','terminal']);
  dot.accept({...base,turns:[{...done('desktop-user'),role:'user'},{...done('desktop-reply'),role:'assistant'}]});
  expect((snapshot.mock.calls.at(-1)?.[0] as import('../src/desktop-cloud-protocol.js').CloudSnapshot).messages[1]?.turnId).toBe('desktop-user');
 });
 it('rejects another chat, old payload, invalid structure',()=>{
  const o=new BrowserCloudObserver({threadId,title:'Cloud'},vi.fn(),vi.fn());
  expect(()=>o.accept({...observation([]),url:'https://example.com'})).toThrow();
  expect(()=>o.accept({...observation([]),observedAt:Date.now()-20000})).toThrow();
  expect(browserObservationSchema.safeParse({...observation([]),command:'send'}).success).toBe(false);
 });
});
