import { describe, expect, it } from "vitest";
import { cleanPhononFillers } from "../src/filler-cleanup.js";
describe("conservative Phonon filler cleanup",()=>{
 it("removes ordinary fillers without rewriting intent",()=>{
  expect(cleanPhononFillers("Um, do not delete 52 files, uh, keep 3 copies.")).toBe("do not delete 52 files, keep 3 copies.");
  expect(cleanPhononFillers("This is um a test, uh anyway, right?")).toBe("This is a test, anyway, right?");
 });
 it("removes ordinary hmm fillers but preserves literal words and names",()=>{
  expect(cleanPhononFillers("Hmm, I think this is hmm a good idea, uh anyway.")).toBe("I think this is a good idea, anyway.");
  expect(cleanPhononFillers("It works. Hmm anyway, I agree.")).toBe("It works. anyway, I agree.");
  for (const input of ['Say "hmm" exactly.', "`hmm` is code", "Dr Hmm and Mr Uh work here.", "Hmm is a surname.", "Hmm?", "/tmp/hmm.txt", "HMM is an acronym."])
   expect(cleanPhononFillers(input)).toBe(input);
 });
 it("cleans continued short phrase restarts while preserving complete echoes and emphasis",()=>{
  expect(cleanPhononFillers("Let's talk the price, how we split, how we split the bill tomorrow.")).toBe("Let's talk the price, how we split the bill tomorrow.");
  for(const [first,second] of [["the delivery arrives","on Tuesday"],["we choose blue","today"],["our meeting happens","tomorrow"]])
   expect(cleanPhononFillers(`${first}, ${first} ${second}.`)).toBe(`${first} ${second}.`);
  for(const text of ["Never again, never again will I do that.","Very good, very good job.","I had, I had had enough.","How we split, how we split.","How we split. How we split the bill.",'Say "how we split, how we split the bill".',"`how we split, how we split the bill`"])
   expect(cleanPhononFillers(text)).toBe(text);
 });
 it("cleans dash-delimited phrase restarts with existing literal/emphasis safeguards",()=>{
  for (const delimiter of [" – ", " — ", " - ", "–", "—", " \u2013\u00a0"]) {
   expect(cleanPhononFillers(`how we split${delimiter}how we split the bill`)).toBe("how we split the bill");
   expect(cleanPhononFillers(`Let's talk the price, how we split${delimiter}how we split the bill tomorrow.`)).toBe("Let's talk the price, how we split the bill tomorrow.");
   for (const phrase of ["the delivery arrives", "we choose blue", "our meeting happens"])
    expect(cleanPhononFillers(`${phrase}${delimiter}${phrase} today.`)).toBe(`${phrase} today.`);
  }
  for (const text of ['"how we split – how we split the bill"', "`how we split — how we split the bill`", "type how we split - how we split the bill", "how we split – how we split.", "how we split. how we split the bill", "very good – very good job", "never again — never again will I do that", "mother-in-law /tmp/how-we-split.txt 52-52", "how we split - a different way to split the bill"])
   expect(cleanPhononFillers(text)).toBe(text);
 });
 it("handles grammatical words inside phrase restarts without deduping grammar",()=>{
  for(const delimiter of [" – "," — "," - ",", "]) {
   for(const [phrase,continuation] of [["how do you","do"],["what is the","price"],["we can go","tomorrow"],["it was the","right choice"],["a good","result"]])
    expect(cleanPhononFillers(`${phrase}${delimiter}${phrase} ${continuation}`)).toBe(`${phrase} ${continuation}`);
  }
  for(const text of ["how do you do", "had had", "I know that that works", "no no", "very very", "I had – I had had enough.", "very good – very good job", '"how do you – how do you do"',"`how do you – how do you do`", "type how do you – how do you do", "A and B – A and B are variables"])
   expect(cleanPhononFillers(text)).toBe(text);
 });
 it("generally collapses repeated token sequences across vocabulary and lengths",()=>{
  const phrases=["how do you", "what is the", "we can go", "our project will use the selected backend", "how much is the", "the bridge will process this recording again", "the account owner wants to discuss the updated delivery schedule tomorrow", "this recorded sentence contains enough ordinary words to exercise a longer restart prefix"];
  for(const phrase of phrases) for(const delimiter of [" ",", "," – "," — "," - "]) {
   expect(cleanPhononFillers(`${phrase}${delimiter}${phrase} correctly`)).toBe(`${phrase} correctly`);
   expect(cleanPhononFillers(`Context. ${phrase}${delimiter}${phrase} correctly. Keep 9 invoices.`)).toBe(`Context. ${phrase} correctly. Keep 9 invoices.`);
  }
  expect(cleanPhononFillers("how do you – how do you – how do you do")).toBe("how do you do");
  expect(cleanPhononFillers("I know that – I know that that works")).toBe("I know that that works");
  for(const phrase of phrases) expect(cleanPhononFillers(`${phrase} – ${phrase}.`)).toBe(`${phrase} – ${phrase}.`);
 });
 it("cleans the user financing restart and explicit truncated clause without paraphrasing",()=>{
  const input = "Wow, I, I can't bel- I can't believe we've actually done it. We've bought a Tesla. It's a blue one, right? Oh no, it was the green one. You're right. Yeah, it was the green one. Okay. So anyway, like, let's look at the financing, but let's, let's, let's look. Let's look at the financing later. And yeah, I'm just so happy that we finally have a Tesla, you know.";
  const expected = "Wow, I can't believe we've actually done it. We've bought a Tesla. It's a blue one, right? Oh no, it was the green one. You're right. Yeah, it was the green one. Okay. So anyway, like, let's look at the financing later. And yeah, I'm just so happy that we finally have a Tesla, you know.";
  expect(cleanPhononFillers(input)).toBe(expected);
 });
 it("generally collapses explicit partial-word clause restarts",()=>{
  const phrases=[['I cannot','believe'],['we should','discuss'],['they will','process'],['our team can','recognize'],['your project should','remember']];
  for(const [prefix,word] of phrases) for(let length=2;length<word!.length;length++) {
   const input=`${prefix} ${word!.slice(0,length)}- ${prefix} ${word} the details tomorrow. Keep 52 files.`;
   expect(cleanPhononFillers(input)).toBe(`${prefix} ${word} the details tomorrow. Keep 52 files.`);
  }
  expect(cleanPhononFillers("We’re pla- we're planning the launch.")).toBe("We’re planning the launch.");
  expect(cleanPhononFillers("I can't bel- I can't believe it.")).toBe("I can't believe it.");
  for(const [input,expected] of [
   ["I cannot bel- I can believe it.","I cannot bel I can believe it."],
   ["We should rec- they should recognize it.","We should rec they should recognize it."],
   ["I will not pro- I will process it.","I will not pro I will process it."],
   ["we have 52 inv- we have 52 invoices.","we have 52 inv we have 52 invoices."]
  ]) expect(cleanPhononFillers(input!)).toBe(expected);
  for(const input of ['Say "I cannot bel- I cannot believe".',"`we should dis- we should discuss`", "use /tmp/bel- and I believe it.","ABC shou- ABC should stay."])
   expect(cleanPhononFillers(input)).toBe(input);
 });
 it("collapses exact redundant clauses joined by but across vocabulary and draft endings",()=>{
  const clauses=["let's look at the financing", "we should discuss the delivery", "our team can recognize this recording", "the selected backend will process this recording", "I will not delete the files", "the meeting starts after lunch", "our project should remember the selected option"];
  for(const clause of clauses) for(const separator of [", ", " – ", " — ", " - "]) for(const cue of ["but ", "But "]) for(const tail of ["", ".", " tomorrow."]) {
   expect(cleanPhononFillers(`${clause}${separator}${cue}${clause}${tail}`)).toBe(`${clause}${tail}`);
   expect(cleanPhononFillers(`Context. ${clause}${separator}${cue}${clause}${tail} Keep 52 files.`)).toBe(`Context. ${clause}${tail} Keep 52 files.`);
  }
  expect(cleanPhononFillers("Let's look at the financing, but let's look at the financing")).toBe("Let's look at the financing");
  for(const input of ["we should discuss delivery, but we should discuss price", "I will not delete files, but I will delete files", "the meeting starts after lunch, but the meeting starts before lunch", "very good, but very good", "I had, but I had had enough", "we have 52 files, but we have 52 files", "Let's look at financing. Let's look at financing", 'Say "we should discuss delivery, but we should discuss delivery".', "`we should discuss delivery, but we should discuss delivery`", "we should discuss /tmp/report.txt, but we should discuss /tmp/report.txt", "ABC will work, but ABC will work"])
   expect(cleanPhononFillers(input)).toBe(input);
 });
 it("generally recognizes spaced dash fragments with case and apostrophe variation",()=>{
  const clauses=[["I can't", "believe"], ["we should", "discuss"], ["they will", "process"], ["our team can", "recognize"], ["your project should", "remember"], ["We’re", "planning"]];
  for(const [prefix,word] of clauses) for(const separator of [" – ", " — ", " - ", "–", "—", " \u2013\u00a0"]) for(let length=2;length<word!.length;length++) for(const tail of ["", " it."]) {
   const repeatedPrefix=prefix!.toLowerCase().replaceAll("’", "'");
   expect(cleanPhononFillers(`${prefix} ${word!.slice(0,length)}${separator}${repeatedPrefix} ${word}${tail}`)).toBe(`${prefix} ${word}${tail}`);
  }
  expect(cleanPhononFillers("I can't bel – I can't believe")).toBe("I can't believe");
  expect(cleanPhononFillers("I CAN'T bel — I can't believe")).toBe("I CAN'T believe");
  expect(cleanPhononFillers("I Can't Bel - I can't believe")).toBe("I Can't believe");
  for(const input of ["I can – I cannot", "I do – I don't", "we are not – we are nothing", "we will go – we will going", "I cannot bel – I can believe", "I will not pro – I will process", "we have 52 inv – we have 52 invoices", "ABC rec – ABC recognize", "we know BEL – we know believe", "We met Bob – we met Bobby", "We chose Tes – we chose Tesla", 'Say "I can’t bel – I can’t believe".', "`I can't bel – I can't believe`", "use /tmp/bel- and I believe", "I can't be. I can't believe"])
   expect(cleanPhononFillers(input)).toBe(input);
 });
 it("cleans short unmarked partial-word clause restarts across vocabulary",()=>{
  expect(cleanPhononFillers("I can't bel I can't believe")).toBe("I can't believe");
  const clauses: [string,string,string[]][]=[["I can't", "believe", ["bel"]], ["we should", "discuss", ["di","dis"]], ["they will", "process", ["pr","pro"]], ["our team can", "recognize", ["re","rec"]], ["your project should", "remember", ["re","rem"]], ["we will", "transcribe", ["tr","tra"]], ["they can", "understand", ["un","und"]]];
  for(const [prefix,word,fragments] of clauses) for(const separator of [" ", ", ", ". ", "\u00a0", "\n", "\u200b"]) for(const fragment of fragments) for(const tail of ["", " the details."]) {
   const input=`Context. ${prefix} ${fragment}${separator}${prefix} ${word}${tail} Keep 52 files.`;
   expect(cleanPhononFillers(input)).toBe(`Context. ${prefix} ${word}${tail} Keep 52 files.`);
  }
  expect(cleanPhononFillers("I can’t bel I can't believe it.")).toBe("I can’t believe it.");
  expect(cleanPhononFillers("I do not bel I do not believe it.")).toBe("I do not believe it.");
  expect(cleanPhononFillers("I can't bel, uh, I can't believe it.")).toBe("I can't believe it.");
  expect(cleanPhononFillers("I can't bel – uh, I can't believe it.")).toBe("I can't believe it.");
  for(const input of ["we can act, we can activate", "I got ace, I got aces", "we need ale, we need alerts", "we need con, we need contacts", "we need bob, we need bobby", "we need cur we need currency", "I need art, I need artists", "we need car we need carpet", "we should rest, we should restore", "we can add we can address", "We met Bob, we met Bobby", "I can't Bel I can't believe", "I can't bel I can't Believe", "I can bel I can't believe", "I cannot bel I can believe", "we have 52 inv we have 52 invoices", "ABC can rec ABC can recognize", "we know BEL we know believe", "I can't belief I can't believe", "please repeat I can't bel I can't believe", 'Say "I can’t bel I can’t believe".', "`I can't bel I can't believe`", "use /tmp/bel and I can't believe"]) expect(cleanPhononFillers(input)).toBe(input);
 });
 it("generally cleans clauses resumed after shorter matching-prefix attempts",()=>{
  const cases=[
   ["let's look at the financing","let's look","later"],
   ["we should discuss the delivery","we should discuss","tomorrow"],
   ["our team can recognize this recording","our team can recognize","again"],
   ["the selected backend will process this recording","the selected backend will","locally"],
   ["I will not delete the files","I will not delete","today"]
  ];
  for(const [whole,short,tail] of cases) for(const separator of [", "," – "," — "," - "]) for(const attemptEnd of [", ",". "," – "]) {
   for(const cue of ["","but "]) {
    expect(cleanPhononFillers(`${whole}${separator}${cue}${short}${attemptEnd}${whole} ${tail}. Keep 52 files.`)).toBe(`${whole} ${tail}. Keep 52 files.`);
    expect(cleanPhononFillers(`${whole}${separator}${cue}${short}${attemptEnd}${short}${attemptEnd}${whole} ${tail}.`)).toBe(`${whole} ${tail}.`);
   }
  }
  for(const input of ["Let's look at financing. Let's look at financing later.","we should discuss delivery, but we should discuss price. We should discuss delivery tomorrow.","I will not delete files, but I will. I will delete files today.","never again, but never. Never again will I do that.","our meeting is at 52 minutes, but our meeting. Our meeting is at 52 minutes tomorrow.","we choose blue, but we choose. We choose blue.", 'Say "we should discuss delivery, but we should. We should discuss delivery tomorrow".',"`let's look at financing, but let's look. Let's look at financing later`", "we should discuss /tmp/report.txt, but we should. We should discuss /tmp/report.txt tomorrow."])
   expect(cleanPhononFillers(input)).toBe(input);
 });
 it("preserves negation, numbers, names and meaningful interjections",()=>{
  expect(cleanPhononFillers("Uh, don't rename Hendrik's 0.6.25 build 51.")).toBe("don't rename Hendrik's 0.6.25 build 51.");
  expect(cleanPhononFillers("Dr Um and Mr Uh have 2 files.")).toBe("Dr Um and Mr Uh have 2 files.");
  expect(cleanPhononFillers("type um and say uh exactly")).toBe("type um and say uh exactly");
  expect(cleanPhononFillers("uh-huh, uh-oh, UM is an acronym, summer")).toBe("uh-huh, uh-oh, UM is an acronym, summer");
 });
 it("preserves quoted words, code, paths and commands",()=>{
  const s='Say "um" and `uh`, use /tmp/um/uh.py and um.txt; run ```echo uh```.';
  expect(cleanPhononFillers(s)).toBe(s);
  expect(cleanPhononFillers("Say 'uh' exactly.")).toBe("Say 'uh' exactly.");
 });
 it("preserves single-quoted passages with contractions, possessives and uncertain endings",()=>{
  const quoted=[
   "'It's blue. I can't bel- I can't believe it. Let's look, let's look at financing later.'",
   "'The teachers' school works. We should discuss delivery, but we should. We should discuss delivery tomorrow.'",
   "‘It’s blue. I can’t bel- I can’t believe it. Let’s look, let’s look at financing later.’",
   "‘The teachers’ school works. We should discuss delivery, but we should. We should discuss delivery tomorrow.’",
   "'It's blue. I can't bel- I can't believe it.",
   "‘The teachers’ school works. I, I agree.",
   "' A quoted passage. I, I agree.'",
   "’It's a passage. I, I agree.’"
  ];
  for(const quote of quoted) for(const prefix of ["","Please preserve ","Um, "]) {
   const input=prefix+quote;
   let diagnostics: unknown;
   expect(cleanPhononFillers(input,value=>{diagnostics=value;})).toBe(input);
   expect(diagnostics).toMatchObject({literalFallback:true,changed:false});
  }
  for(const input of ["Um, it's it's the teachers' school.","Um, it’s it’s the teachers’ school."])
   expect(cleanPhononFillers(input)).toBe(input.startsWith("Um, it's") ? "it's the teachers' school." : "it’s the teachers’ school.");
  expect(cleanPhononFillers("Um, O'Connor's team agrees.")).toBe("O'Connor's team agrees.");
 });
 it("cleans clear stutters and narrow pronoun false starts",()=>{
  expect(cleanPhononFillers("This is a recording, I-I-I-I guess, when-when it works.")).toBe("This is a recording, I guess, when it works.");
  expect(cleanPhononFillers("I I guess w-w-when g-g-guess uh, it works.")).toBe("I guess when guess it works.");
 });
 it("preserves emphasis, grammar, literals and valid hyphens",()=>{
  const s = "no no, very very good, had had enough, I know that that works, no-no, very-very, mother-in-law, 52-52, x-x-axis, /tmp/I-I.txt, when-when.txt";
  expect(cleanPhononFillers(s)).toBe(s);
  const literals = 'Say "I-I-I" and `when-when`, type when-when exactly, say I-I exactly.';
  expect(cleanPhononFillers(literals)).toBe(literals);
 });
 it("cleans the exact watch screenshot and apostrophe variants",()=>{
  expect(cleanPhononFillers("improvement. I think it's it's really great and b because of that, it's")).toBe("improvement. I think it's really great and because of that, it's");
  expect(cleanPhononFillers("It's it's.")).toBe("It's.");
  expect(cleanPhononFillers("It’s it’s good because because we we can do it.")).toBe("It’s good because we can do it.");
  expect(cleanPhononFillers("I think it's-it's b-b-because wh when it works.")).toBe("I think it's because when it works.");
 });
 it("preserves ambiguous repetitions and meaningful short words",()=>{
  const s = "had had, that that, is is, no no, very very, really really, can can, I improve, a apple, be because, in inside, IT IT, B because, 52 52, A-A, go-go, bye-bye";
  expect(cleanPhononFillers(s)).toBe(s);
  for (const s of ["Spell b because exactly", "type it's it's", "say when when", "use `b because it's it's` and /tmp/when-when.txt", `keep "it's it's" unchanged`]) expect(cleanPhononFillers(s)).toBe(s);
 });
 it("cleans exact will prefixes and their duplicate continuations",()=>{
  for (const s of ["I w will tell you", "I wil-will tell you", "I wil-will will tell you", "I w will will tell you", "I (wil-will) tell you"])
   expect(cleanPhononFillers(s)).toBe(s.includes("(") ? "I (will) tell you" : "I will tell you");
  expect(cleanPhononFillers("A-anyway, I w-way will go.")).toBe("Anyway, I way will go.");
  expect(cleanPhononFillers("I w won't and w-won’t do that.")).toBe("I won't and won’t do that.");
 });
 it("cleans narrow comma-separated identical phrase restarts",()=>{
  expect(cleanPhononFillers("I hope I hope it works")).toBe("I hope it works");
  expect(cleanPhononFillers("I hope, I hope it works")).toBe("I hope it works");
  expect(cleanPhononFillers("I hope, I hope, I hope it works.")).toBe("I hope it works.");
  for (const s of ["I hope! I hope!", "I hope, you hope it works", "I hope it works, I hope it fails", "I hope, I don't hope", "I hope and I hope", "no no, very very", '"I hope, I hope"']) expect(cleanPhononFillers(s)).toBe(s);
 });
 it("handles latest screenshot without guessing misrecognized pronouns",()=>{
  expect(cleanPhononFillers("doesn't transcribe everything w way overkill.")).toBe("doesn't transcribe everything way overkill.");
  const s = "So this is just test and I think it hope I hope it works better than";
  expect(cleanPhononFillers(s)).toBe(s);
  expect(cleanPhononFillers("car carpet, man manage, app application, can cannot")).toBe("car carpet, man manage, app application, can cannot");
 });
 it("preserves letters, names, compounds and literal prefixes",()=>{
  for (const s of ["A anyway, I improve, a apple, W will, B because, Will Will", "A-axis, I-improve, x-axis, mother-in-law, 52-52", "spell w will", "type wil-will", "use `wil-will` and https://example.test/w-way", '"A-anyway" and /tmp/wil-will.txt']) expect(cleanPhononFillers(s)).toBe(s);
 });
 it("cleans general vocabulary restart chains, including the latest screenshot",()=>{
  expect(cleanPhononFillers("transcribing any of m my my my stutter or not. And the pauses as")).toBe("transcribing any of my stutter or not. And the pauses as");
  expect(cleanPhononFillers("mm- my,my,my")).toBe("my");
  const vocabulary = ["milk", "recording", "stutter", "because", "transcribe", "example", "useful", "tomorrow", "my"];
  for (const word of vocabulary) for (const separator of [" ", ", ", "-"]) for (const count of [2,3,4]) {
   expect(cleanPhononFillers(Array(count).fill(word).join(separator))).toBe(word);
   expect(cleanPhononFillers(word[0] + " " + Array(count).fill(word).join(separator))).toBe(word);
  }
  for (const s of ["had had", "that that", "very very", "no no", "really really", "a a", "I improve", "52 52", "ABC ABC", "Will Will", "repeat milk milk twice", '"milk milk"', "`my my` /tmp/my-my.txt"]) expect(cleanPhononFillers(s)).toBe(s);
 });
 it("cleans clear sentence-boundary capitalized fillers without deleting names",()=>{
  expect(cleanPhononFillers("hope this is working. Um anyway, I think that this will work and I")).toBe("hope this is working. anyway, I think that this will work and I");
  expect(cleanPhononFillers("Um anyway, it works! Uh, I agree. Um I think so.")).toBe("anyway, it works! I agree. I think so.");
  for (const s of ["Dr Um and Mr Uh have 2 files.", "Um is a surname. Uh is a name.", '"Um anyway" is quoted.', "`Um anyway`", "M anyway, UM is an acronym.", "Um knows Hendrik."])
   expect(cleanPhononFillers(s)).toBe(s);
 });
 it("handles the latest readability examples with semantic/literal safeguards",()=>{
  expect(cleanPhononFillers("amazing. Anyway, anyway, it doesn't really matter if it works")).toBe("amazing. Anyway, it doesn't really matter if it works");
  expect(cleanPhononFillers("think that hopefully it will work a and that is that that would be amazing. Anyway")).toBe("think that hopefully it will work and that is that would be amazing. Anyway");
  expect(cleanPhononFillers("A-And it works")).toBe("And it works");
  expect(cleanPhononFillers("I say it works. Anyway, anyway, it works.")).toBe("I say it works. Anyway, it works.");
  for (const s of ["I know that that works", "The issue is that that works", "had had", "a and B are letters", "A and B", "a and b are variables", "a apple, I improve", "Anyway. Anyway, it works", "type a and that that", "`a and that that` /tmp/anyway-anyway.txt"]) expect(cleanPhononFillers(s)).toBe(s);
  for (const word of ["anyway", "recording", "tomorrow", "result", "works", "hope", "readability"]) {
   const upper = word[0]?.toUpperCase() + word.slice(1);
   for (const sep of [" ", ", ", "-"]) expect(cleanPhononFillers(upper + sep + word + " continues")).toBe(upper + " continues");
  }
 });
 it("cleans the final supplied snippet through nonliteral context and Unicode separators",()=>{
  const body = "that it should work anyway anyway it hopefully it works and";
  expect(cleanPhononFillers(body)).toBe("that it should work anyway it hopefully it works and");
  for (const separator of [" ", "\n", "\r\n", "\u00a0", "\u2009", "\u200b"]) expect(cleanPhononFillers("work anyway" + separator + "anyway it works")).toBe("work anyway it works");
  for (const prefix of ["I say I think ", "This is a spelling test. ", "I write it down and ", "I think it will repeat this and "]) expect(cleanPhononFillers(prefix + body)).toBe(prefix + "that it should work anyway it hopefully it works and");
  for (const s of ["say anyway anyway", "spell w will", "type wil-will", "word um", '"anyway anyway"', "`anyway anyway`", 'Write "um, uh']) expect(cleanPhononFillers(s)).toBe(s);
 });
 it("reports bounded pipeline diagnostics without transcript content",()=>{
  let trace: unknown;
  const result = cleanPhononFillers("work anyway anyway it works", value => {trace=value;});
  expect(result).toBe("work anyway it works");
  expect(trace).toMatchObject({version:"fragment-align-4",changed:true,inputAdjacentRepeats:1,outputAdjacentRepeats:0,literalFallback:false});
  expect(JSON.stringify(trace)).not.toContain("anyway");
 });
 it("preserves ambiguous literals and filler-only results",()=>{
  expect(cleanPhononFillers('Write "um, uh')).toBe('Write "um, uh');
  expect(cleanPhononFillers("um, uh")).toBe("um, uh");
 });
});
