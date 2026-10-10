import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanPhononFillers} from "../src/filler-cleanup.js";
import {resolveExplicitClauseCorrections} from "../src/explicit-correction.js";
import {collapseClarifiedActionRestarts,collapseRevisedClauseRestarts} from "../src/copular-correction.js";
import {LocalDraftEditor} from "../src/draft-editor.js";
import {BridgeService} from "../src/bridge-service.js";

afterEach(()=>vi.unstubAllEnvs());
const visible="Wow. Anyway, I think that we should work on the car. Uh the car's design. I think we should work on the car's design and make it pink. No, make it green.";
const expected="Wow. Anyway, I think that we should work on the car's design and make it green.";
describe("sentence fillers, local imperative corrections and clarified action restarts",()=>{
 it("removes sentence-initial title-case fillers before ordinary phrases",()=>{
  for(const filler of ["Uh","Um","Hmm"])for(const phrase of ["the car's design","their project is ready","a useful result","that looks good","don't cancel it","everything is ready","this works","maybe Friday"]){
   expect(cleanPhononFillers(`Context. ${filler} ${phrase}. Keep 52 files.`)).toBe(`Context. ${phrase}. Keep 52 files.`);
  }
  for(const input of ['Say "Uh the car".',"`Um the project`","Dr Um met Mr Uh.","Um is a surname.","Um has a book.","Uh was named after his father.","Um Alexander is here.","UM is an acronym.","Uh-huh, uh-oh."])
   expect(cleanPhononFillers(input)).toBe(input);
 });
 it("uses repeated action/object anchors rather than a color or verb whitelist",()=>{
  for(const [verb,object,from,to] of [["make","it","pink","green"],["paint","them","blue","red"],["keep","it","warm","cool"],["set","it","higher","lower"],["leave","them","closed","open"],["make","it","light pink","light green"]]){
   for(const cue of ["No, ","no ","No. ","No — ","No, actually, ","No, wait. "]){
    const input=`Hello. I think we should ${verb} ${object} ${from}. ${cue}${verb} ${object} ${to}. Keep 52 files.`;
    expect(resolveExplicitClauseCorrections(input)).toMatchObject({text:`Hello. I think we should ${verb} ${object} ${to}. Keep 52 files.`,count:1});
   }
  }
  expect(resolveExplicitClauseCorrections("Make it pink. No, make it green, and keep the Friday meeting.").text).toBe("Make it green, and keep the Friday meeting.");
 });
 it("preserves ambiguous targets, changed anchors, names, numbers, polarity and literals",()=>{
  for(const input of [
   "Make it pink and keep it blue. No, make it green.","Make it pink and make it blue. No, make it green.",
   "Make it pink. No, paint it green.","Paint it red. No, paint them blue.",
   "Do not make it pink. No, make it green.","Make it not pink. No, make it green.",
   "Make it pink tomorrow. No, make it green today.","Make it maybe pink. No, make it green.",
   "Set it 12. No, set it 13.","Make it Tesla. No, make it Toyota.",
   "Make it very pink. No, make it dark green.","Make it pink? No, make it green.",
   'Say "Make it pink. No, make it green." exactly.',"Make it /tmp/red.txt. No, make it /tmp/green.txt.",
  ])expect(resolveExplicitClauseCorrections(input)).toEqual({text:input,count:0});
 });
 it("collapses a standalone possessive clarification followed by the same action",()=>{
  const matrix: [string,string,string][]=[["work on","car","design"],["repair","house","roof"],["review","page","layout"],["improve","app","interface"],["discuss","project","schedule"]];
  for(const [action,noun,part] of matrix)for(const [firstLead,lastLead] of [["I think that ","I think "],["I think ","I think that "],["",""]])for(const modal of ["should","could","will"]){
   const first=`Anyway, ${firstLead}we ${modal} ${action} the ${noun}.`;
   const last=`${lastLead}we ${modal} ${action} the ${noun}'s ${part} and keep the meeting.`;
   const input=`Hello. ${first} The ${noun}'s ${part}. ${last} Goodbye.`;
   expect(collapseClarifiedActionRestarts(input)).toEqual({text:`Hello. Anyway, ${firstLead}we ${modal} ${action} the ${noun}'s ${part} and keep the meeting. Goodbye.`,count:1});
  }
  expect(collapseRevisedClauseRestarts(cleanPhononFillers(visible)).text).toBe("Wow. Anyway, I think that we should work on the car's design and make it pink. No, make it green.");
 });
 it("retains independent facts, different intentions, qualifications, literals and deliberate lists",()=>{
  const base="We should work on the car. The car's design. We should work on the car's design.";
  const unchanged=[
   "We should work on the car. The car's engine. We should work on the car's design.",
   "We should work on the car. The car's design. We could work on the car's design.",
   "I think we should work on the car. The car's design. We should work on the car's design.",
   "We should work on the car. The car's design. I think we should work on the car's design.",
   "We should work on the car. The car's design is good. We should work on the car's design.",
   "We should work on the car. The car's design. Also, we should work on the car's design.",
   "We should not work on the car. The car's design. We should not work on the car's design.",
   "Maybe we should work on the car. The car's design. Maybe we should work on the car's design.",
   "We should work on the car today. The car's design. We should work on the car's design tomorrow.",
   "We should work on the Car. The Car's design. We should work on the Car's design.",
   "We should work on the car. The car's design. We should work on the car's design for 12 hours.",
   base.replace("car. ","car? "),base.replace("car. ","car.\n"),`Say "${base}" exactly.`,`\`${base}\``,
   "List the items. "+base,
  ];
  for(const input of unchanged)expect(collapseClarifiedActionRestarts(input)).toEqual({text:input,count:0});
 });
 it("fixes the displayed watch draft through the real handler with raw retained and zero model calls",async()=>{
  const request=vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected model call"));const sent=vi.fn();
  const service=Object.create(BridgeService.prototype);
  Object.assign(service,{config:{defaultCwd:"/tmp"},transcriber:{defaultBackend:"phonon",transcribe:async()=>visible},draftEditor:new LocalDraftEditor(request),send:sent});
  await service.createTranscription({version:1,kind:"transcription.create",requestId:"synthetic-clarified-action",threadId:null,backend:"phonon",mimeType:"audio/aac",audioBase64:Buffer.alloc(2048).toString("base64"),finalIntent:true});
  expect(sent.mock.calls[0]?.[0]).toMatchObject({text:expected,rawText:visible});
  expect(request).not.toHaveBeenCalled();
  expect(sent.mock.calls[0]?.[0].editNotice).toContain("Possible clause restart removed");
 });
 it("keeps inferred object merging optional",async()=>{
  vi.stubEnv("AGENTIC_WEAR_PHONON_CLAUSE_REPAIRS","0");
  const request=vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected model call"));
  const result=await new LocalDraftEditor(request).rewrite(cleanPhononFillers(visible),undefined,{explicitCorrections:true,clauseRestarts:true});
  expect(result.text).toBe("Wow. Anyway, I think that we should work on the car. the car's design. I think we should work on the car's design and make it green.");
  expect(request).not.toHaveBeenCalled();
 });
});
