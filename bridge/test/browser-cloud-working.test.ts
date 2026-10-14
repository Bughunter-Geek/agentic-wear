import {describe,it,expect,vi} from "vitest";
import {BrowserCloudObserver,browserObservationSchema,type BrowserObservation} from "../src/browser-cloud-observer.js";
const id="00000000-0000-4000-8000-000000000001";
const done={id:"old",reply:"old reply",completed:true,evidence:"response-actions-without-stop" as const};
const pending={id:"next",reply:"partial",completed:false,evidence:null};
const frame=(turns:BrowserObservation["turns"]):BrowserObservation=>({version:1,kind:"observation",url:`https://chatgpt.com/local/${id}`,documentId:id,observedAt:Date.now(),extractionMs:1,visibility:"hidden",blocked:false,turns});
function setup(){const snapshot=vi.fn(),terminal=vi.fn();return {snapshot,terminal,o:new BrowserCloudObserver({threadId:id,title:"Set up ai-news-android",sendEnabled:true},snapshot,terminal)};}
describe("cloud working status follows current browser generation",()=>{
 it("stops showing active without inventing completion or losing a late receipt",()=>{
  const {o,snapshot,terminal}=setup();o.accept(frame([done]));
  o.accept({...frame([done,pending]),generationActive:true});
  o.accept({...frame([done,pending]),generationActive:false});
  expect(snapshot.mock.calls.at(-1)?.[0].status).toBe("idle");expect(terminal).not.toHaveBeenCalled();
  expect(snapshot.mock.calls.at(-1)?.[0].messages.at(-1).phase).not.toBe("final_answer");
  o.accept({...frame([done,{...done,id:"next"}]),generationActive:false});expect(terminal).toHaveBeenCalledOnce();
 });
 it("clears stale work for legacy observations with a ready composer",()=>{
  const {o,snapshot}=setup();o.accept(frame([done]));o.accept({...frame([done,pending]),inputReady:true});
  expect(snapshot.mock.calls.at(-1)?.[0].status).toBe("idle");
 });
 it("shows real generation before an incomplete assistant row appears",()=>{
  const {o,snapshot}=setup();o.accept({...frame([done]),generationActive:true});
  expect(snapshot.mock.calls.at(-1)?.[0].status).toBe("active");
 });
 it("an idle draft is not generation even with an old unfinished turn",()=>{
  const {o,snapshot}=setup();o.accept(frame([done]));o.accept({...frame([done,pending]),inputReady:false,generationActive:false});
  expect(snapshot.mock.calls.at(-1)?.[0].status).toBe("idle");
 });
 it("accepts only boolean generation metadata",()=>{
  expect(browserObservationSchema.safeParse({...frame([done]),generationActive:false}).success).toBe(true);
  expect(browserObservationSchema.safeParse({...frame([done]),generationActive:"idle"}).success).toBe(false);
 });
 it("publishes current generation on an empty page without treating history as a new completion",()=>{
  const {o,snapshot,terminal}=setup();o.accept({...frame([]),generationActive:true});
  expect(snapshot.mock.calls.at(-1)?.[0].status).toBe("active");
  o.accept({...frame([done]),generationActive:false});expect(terminal).not.toHaveBeenCalled();
 });
});
