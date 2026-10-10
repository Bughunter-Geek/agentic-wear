/** Deterministic opt-out cleanup. Protect literal spans; uncertainty leaves the raw text alone. */
// Without an explicit dash, only short fragments with a repeated clause
// anchor qualify. Common complete words remain literal/semantic contrasts.
const completeFragments = new Set("a i an am as at be by do go he if in is it me my no of oh on or so to up us we ah uh um ace act ad add age ago aid aim air ale all and any app are arm art ash ask ate bad bag ban bar bat bay bed bee beg bet bid big bin bit bob bow box boy bug bus but buy cab can cap car cat con cop cot cow cry cup cut dad day den did die dig dim dip dog dot dry due dye ear eat egg end era eve eye fan far fat fax fed fee few fig fin fit fix fly foe fog for fox fry fun gap gas gel gem get god got gum gun guy gym had ham has hat hay hen her hid him hip his hit hot how hub hug ice ill ink inn its jam jar jet job jog joy key kid kit lab lap law lay leg let lid lie lip lit log lot low mad man map mat max may med men met mid mix mob mom mop mud mug nap net new nod nor not now nut oak odd off old one opt orb ore our out owe owl own pad pal pan par pat paw pay pea peg pen per pet pie pig pin pit ply pod pop pot pry pub put rag ram ran rap rat raw ray red rib rid rim rip rob rod rot row rub rug rum run sad sag sat saw say sea see set sew she shy sin sip sir sit six ski sky sly son sow soy spa spy sub sue sum sun tab tag tan tap tar tax tea tee ten the tie tin tip toe ton too top toy try tub two use van vat vet via vie vow war was wax way web wed wee wet who why wig win wit won wow yak yes yet you zoo".split(" "));
const fragmentAuxiliaries = new Set("can can't cannot could couldn't should shouldn't will won't would wouldn't must mustn't might may do don't does doesn't did didn't".split(" "));
export type CleanupDiagnostics = { version: string; literalFallback: boolean; protectedSpanCount: number; changed: boolean; inputAdjacentRepeats: number; outputAdjacentRepeats: number; nonAsciiWhitespace: boolean };
export function cleanPhononFillers(raw: string, onDiagnostics?: (value: CleanupDiagnostics) => void): string {
  let protectedSpanCount = 0;
  const repeats = (text: string): number => [...text.matchAll(/\b([A-Za-z]+(?:[’'][A-Za-z]+)?)(?:[\p{White_Space}\u200B\uFEFF]+|[\p{White_Space}\u200B\uFEFF]*,[\p{White_Space}\u200B\uFEFF]*|-)\1\b/giu)].length;
  const finish = (text: string, literalFallback = false): string => {
    onDiagnostics?.({version: "fragment-align-4", literalFallback, protectedSpanCount, changed: text !== raw,
      inputAdjacentRepeats: repeats(raw), outputAdjacentRepeats: repeats(text), nonAsciiWhitespace: /[^\S \t\r\n]|[\u200B\uFEFF]/u.test(raw)});
    return text;
  };
  // Unclosed code or double/curly quotes could contain a literal filler word.
  if ((raw.match(/`/gu)?.length ?? 0) % 2 || (raw.match(/"/gu)?.length ?? 0) % 2
    || (raw.match(/“/gu)?.length ?? 0) !== (raw.match(/”/gu)?.length ?? 0)) return finish(raw, true);
  // Single quotes are also apostrophes. A boundary-opening quote may
  // contain contractions or plural possessives, so regex matching cannot
  // identify its end safely. Preserve the entire draft rather than expose
  // any quoted words to cleanup; ordinary in-word apostrophes stay eligible.
  if (/(?<![\p{L}\p{N}])[‘’']/u.test(raw)) return finish(raw, true);
  // General repeated vocabulary, with explicit grammatical/emphasis exceptions.
  // Text alone cannot distinguish every intentional repetition; retain raw.
  const repeatExceptions = new Set(["a", "had", "is", "was", "were", "can", "do", "did",
    "no", "yes", "very", "really", "so", "too", "more", "much", "well", "never", "please", "again", "go", "bye"]);
  // Whole-phrase restarts do not remove grammatical word pairs inside the
  // surviving phrase. Keep emphasis safeguards separate from token dedupe.
  const phraseExceptions = new Set(["had", "no", "yes", "very", "really", "so", "too", "more", "much", "well", "never", "please", "again", "bye"]);
  const completeShortWords = new Set(["a", "i", "an", "am", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it", "me", "my", "no", "of", "oh", "on", "or", "so", "to", "up", "us", "we", "ah", "uh", "um"]);
  const normalized = (word: string): string => word.toLowerCase().replace(/’/gu, "'");
  const cleanPair = (first: string, second: string, hyphenated = false, before = "", after = ""): string | null => {
    const a = normalized(first), b = normalized(second);
    if (a === "that" && b === "that" && !hyphenated) {
      // Complement + demonstrative is grammatical: I know that that works.
      // A bare pair has insufficient context. Explicit "that is" is a restart.
      const preceding = before.trimEnd();
      if (!preceding || !preceding.split(/[,;:.!?]/u).at(-1)?.trim() || (/\b(?:know|think|believe|hope|ensure|see|said|say|feel|heard|means|is|was|were)\s*$/iu.test(preceding)
        && !/\bthat\s+is\s*$/iu.test(preceding))) return null;
    }
    if (a === "a" && b === "and" && (hyphenated || (first === "a" && /^[\p{White_Space}\u200B\uFEFF]+[a-z]{2,}\b/u.test(after))))
      return first === "A" ? "And" : second;
    if (a === b && !repeatExceptions.has(b) && (b.length >= 2 || first === "I")
      && !(/^[A-Z]{2,}$/u.test(first) || /^[A-Z]{2,}$/u.test(second))
      && !(first !== "I" && /^[A-Z][a-z]+$/u.test(first) && /^[A-Z][a-z]+$/u.test(second))) return first;
    // A-anyway is explicit fragmentation; spaced A anyway is still meaningful.
    if (hyphenated && a === "a" && b === "anyway") return first === "A" ? "Anyway" : second;
    // Preserve meaningful short words/acronyms; hyphenated fragments can end
    // in three-letter words, e.g. w-way. Spaces require a longer continuation.
    const prefix = /^([a-z])\1{1,2}$/u.test(a) ? a[0] ?? a : a;
    if (/^[a-z]{1,3}$/u.test(first) && !completeShortWords.has(a)
      && (a.length < 3 || ["wil", "bec", "whe", "wha", "thi", "tha"].includes(a))
      && b.length >= 2 && prefix.length < b.length && b.startsWith(prefix)
      && /^[a-z][a-z’']*$/u.test(second)) return second;
    return null;
  };
  const protectedSpan = /```[\s\S]*?```|`[^`]*`|"[^"]*"|(?<![A-Za-z])'[^'\n]*'(?![A-Za-z])|“[^”]*”|‘[^’]*’|(?:^|(?<=[.!?\n]))[\p{White_Space}]*(?:please\s+)?(?:say|type|write|repeat|list)\b[^.!?\n]*|\b(?:spell|literal|verbatim)\b[^.!?\n]*|\b(?:say|type|write|named|called|repeat|list|word)\s+([A-Za-z]+(?:[’\x27][A-Za-z]+)?)(?:(?:\s+|\s*,\s*|-)\1)*|\S*[/\\_]\S*|\S*\.[A-Za-z0-9]\S*|\S*-\S*/giu;
  const cleanStutterToken = (token: string): string => {
    const match = token.match(/^([([{]*)([A-Za-z’']+(?:-[A-Za-z’']+)+)([,.!?;:)\]}]*)$/u);
    if (!match?.[2]) return token;
    const words = match[2].split("-");
    let changed = false;
    for (let i = 0; i < words.length - 1;) {
      const first = words[i], second = words[i + 1];
      const replacement = first && second ? cleanPair(first, second, true) : null;
      if (replacement !== null) { words.splice(i, 2, replacement); changed = true; i = 0; }
      else i++;
    }
    return changed && words.length === 1 ? (match[1] ?? "") + words[0] + (match[3] ?? "") : token;
  };
  const cleanPlain = (part: string): string => {
    const original = part;
    // Remove adjacent phrase restarts across vocabulary and lengths before
    // token-level fragments. Literal spans and complete echoes stay protected.
    let beforeStutters: string;
    do {
      beforeStutters = part;
      // Unpunctuated title-case fillers also precede clear determiner,
      // pronoun/discourse starters. Ambiguous name + verb phrases remain.
      part = part.replace(/(^|[.!?][\p{White_Space}\u200B\uFEFF]+)(?:Um|Uh|Hmm)(?:[,;:][\p{White_Space}\u200B\uFEFF]*|[\p{White_Space}\u200B\uFEFF]+(?=(?:I|we|you|they|he|she|it|there|here|let['’]s|the|a|an|this|that|these|those|my|our|your|their|his|her|its|anyway|well|okay|actually|so|maybe|probably|perhaps|everything|anything|something|nothing|everyone|someone|anyone|nobody|don['’]t)\b))/gu, "$1").replace(/(^|[\s,;:!?])(?:um|uh|hmm)(?=$|[\s,;:!?.])[,;:]?[\p{White_Space}\u200B\uFEFF]*/gu, "$1");
      part = collapseInterruptedRestart(part, phraseExceptions);
      part = collapsePhraseRestart(part, phraseExceptions);
      // Retain the historical short-fragment behavior after longer restart
      // matching has had a chance to use its explicit truncation marker.
      part = part.replace(/(?<![\p{L}\p{N}’'])([a-z]{1,3})-(?=[\p{White_Space}\u200B\uFEFF]+[A-Za-z])/gu, (whole, word: string) => completeShortWords.has(word) ? whole : word);
      for (const match of part.matchAll(/(?=(?<![\p{L}\p{N}’'])([A-Za-z]+(?:[’'][A-Za-z]+)?)(?:[\p{White_Space}\u200B\uFEFF]+|[\p{White_Space}\u200B\uFEFF]*,[\p{White_Space}\u200B\uFEFF]*)([A-Za-z]+(?:[’'][A-Za-z]+)?)(?![\p{L}\p{N}’']))/gu)) {
        if (!match[1] || !match[2]) continue;
        const pair = part.slice(match.index).match(/^[A-Za-z]+(?:[’'][A-Za-z]+)?(?:[\p{White_Space}\u200B\uFEFF]+|[\p{White_Space}\u200B\uFEFF]*,[\p{White_Space}\u200B\uFEFF]*)[A-Za-z]+(?:[’'][A-Za-z]+)?/u)?.[0];
        if (!pair) continue;
        const replacement = cleanPair(match[1], match[2], false, part.slice(0, match.index), part.slice(match.index + pair.length));
        if (replacement === null) continue;
        part = part.slice(0, match.index) + replacement + part.slice(match.index + pair.length);
        break;
      }
    } while (part !== beforeStutters);
    if (part === original) return original;
    return part.replace(/([,;:])(?:[\p{White_Space}\u200B\uFEFF]*[,;:])+/gu, "$1")
    .replace(/[\p{White_Space}\u200B\uFEFF]{2,}/gu, " ")
    .replace(/[\p{White_Space}\u200B\uFEFF]+([,.!?;:])/gu, "$1");
  };
  let result = "", pending = "", last = 0;
  for (const match of raw.matchAll(protectedSpan)) {
    protectedSpanCount++;
    pending += raw.slice(last, match.index);
    const stutter = cleanStutterToken(match[0]);
    if (match[0] === "-") pending += match[0]; // A spaced dash is punctuation, not a compound/code token.
    else if (/^[a-z]+-$/u.test(match[0])) pending += match[0];
    else if (stutter !== match[0]) pending += stutter;
    else { result += cleanPlain(pending) + match[0]; pending = ""; }
    last = match.index + match[0].length;
  }
  result += cleanPlain(pending + raw.slice(last));
  result = result.replace(/^[ \t,;:]+/u, "").trim();
  // Do not turn filler-only recognition into an empty draft.
  return finish(/[\p{L}\p{N}]/u.test(result) ? result : raw);
}

/** Find the longest adjacent repeated word sequence followed by continuation.
 * Rolling hashes avoid comparing every token of every candidate; a matching
 * hash is always verified token-by-token. Literal spans are removed by caller. */
function collapsePhraseRestart(text: string, emphasis: Set<string>): string {
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+(?:[’'][\p{L}]+)*/gu)].map(m => ({
    start: m.index, end: m.index + m[0].length, text: m[0], key: m[0].toLowerCase().replaceAll("’", "'") }));
  const count = tokens.length;
  if (count < 5) return text;
  const white = /^[\p{White_Space}\u200B\uFEFF]+$/u;
  const separator = /^(?:[\p{White_Space}\u200B\uFEFF]+|[\p{White_Space}\u200B\uFEFF]*(?:[,–—]|(?<=[\p{White_Space}])-(?=[\p{White_Space}]))[\p{White_Space}\u200B\uFEFF]*)$/u;
  const space: boolean[] = [], center: boolean[] = [];
  for (let i = 0; i < count - 1; i++) {
    const gap = text.slice(tokens[i]!.end, tokens[i + 1]!.start);
    space[i] = white.test(gap); center[i] = separator.test(gap);
  }
  const runEnd = Array.from({ length: count }, () => count);
  for (let i = count - 2; i >= 0; i--) runEnd[i] = space[i] ? runEnd[i + 1]! : i + 1;
  const hashes = new Uint32Array(count + 1), powers = new Uint32Array(count + 1), protectedCount = new Uint32Array(count + 1);
  powers[0] = 1;
  for (let i = 0; i < count; i++) {
    const token = tokens[i]!; let hash = 2166136261;
    for (let j = 0; j < token.key.length; j++) hash = Math.imul(hash ^ token.key.charCodeAt(j), 16777619) >>> 0;
    hashes[i + 1] = (Math.imul(hashes[i]!, 65599) + hash) >>> 0;
    powers[i + 1] = Math.imul(powers[i]!, 65599) >>> 0;
    const protectedToken = /\p{N}/u.test(token.text) || /^[A-Z]{2,}$/u.test(token.text)
      || token.text !== "I" && /^[A-Z]$/u.test(token.text);
    protectedCount[i + 1] = protectedCount[i]! + (protectedToken ? 1 : 0);
  }
  const sliceHash = (start: number, length: number) => (hashes[start + length]! - Math.imul(hashes[start]!, powers[length]!)) >>> 0;
  for (let start = 0; start < count - 4; start++) {
    const maxLength = Math.min(runEnd[start]! - start, Math.floor((count - start - 1) / 2));
    for (let length = maxLength; length >= 2; length--) {
      const second = start + length, end = second + length;
      // Preserve short emphatic/grammatical echoes. An emphasis word inside a
      // longer ordinary clause is not a reason to veto the entire restart.
      if (emphasis.has(tokens[start]!.key) || length === 2 && emphasis.has(tokens[start + 1]!.key)) continue;
      if (runEnd[second]! < end || !center[second - 1] || !space[end - 1]
        || protectedCount[second] !== protectedCount[start] || protectedCount[end] !== protectedCount[second]
        || sliceHash(start, length) !== sliceHash(second, length)) continue;
      if (!tokens.slice(start, second).every((token, offset) => token.key === tokens[second + offset]!.key)) continue;
      // Keep the first copy's exact wording/case; drop its abandoned restart.
      return text.slice(0, tokens[second - 1]!.end) + text.slice(tokens[end - 1]!.end);
    }
  }
  return text;
}


/** Collapse interrupted restarts only when every abandoned word is a prefix
 * of the surviving clause. Different clauses, polarity, numbers and literals
 * are never inferred or paraphrased. This covers explicit truncated words and
 * a longer clause resumed after one or more shorter attempts at that clause. */
function collapseInterruptedRestart(text: string, emphasis: Set<string>): string {
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+(?:[’'][\p{L}]+)*/gu)].map(m => ({
    start: m.index, end: m.index + m[0].length, text: m[0], key: m[0].toLowerCase().replaceAll("’", "'") }));
  const count = tokens.length;
  if (count < 4) return text;
  const white = /^[\p{White_Space}\u200B\uFEFF]+$/u;
  const restart = /^(?:[\p{White_Space}\u200B\uFEFF]*[,–—][\p{White_Space}\u200B\uFEFF]*|[\p{White_Space}\u200B\uFEFF]+-[\p{White_Space}\u200B\uFEFF]+)$/u;
  const shortRestart = /^(?:[\p{White_Space}\u200B\uFEFF]*[,.–—][\p{White_Space}\u200B\uFEFF]*|[\p{White_Space}\u200B\uFEFF]+-[\p{White_Space}\u200B\uFEFF]+)$/u;
  const gaps = tokens.slice(0, -1).map((token, index) => text.slice(token.end, tokens[index + 1]!.start));
  const safe = tokens.map(token => !/\p{N}/u.test(token.text) && !/^[A-Z]{2,}$/u.test(token.text)
    && (token.text === "I" || !/^[A-Z]$/u.test(token.text)));
  const runEnd = Array.from({ length: count }, () => count);
  for (let i = count - 2; i >= 0; i--) runEnd[i] = white.test(gaps[i]!) ? runEnd[i + 1]! : i + 1;
  const safeRange = (start: number, end: number): boolean => safe.slice(start, end).every(Boolean);
  const protectedEcho = (start: number, length: number): boolean => emphasis.has(tokens[start]!.key)
    || length === 2 && emphasis.has(tokens[start + 1]!.key);

  // An explicit dash plus a non-word prefix distinguishes an abandoned
  // clause from a complete echo. Match all dash forms emitted by recognition;
  // the preceding words must agree, and polarity/grammatical words stay protected.
  const truncation = /^(?:-[\p{White_Space}\u200B\uFEFF]+|[\p{White_Space}\u200B\uFEFF]*[–—][\p{White_Space}\u200B\uFEFF]*|[\p{White_Space}\u200B\uFEFF]+-[\p{White_Space}\u200B\uFEFF]+)$/u;
  const unmarked = /^(?:[\p{White_Space}\u200B\uFEFF]+|[\p{White_Space}\u200B\uFEFF]*[,.][\p{White_Space}\u200B\uFEFF]+)$/u;
  for (let fragment = 1; fragment < count - 1; fragment++) {
    const explicit = truncation.test(gaps[fragment]!);
    // Unpunctuated ASR often keeps the partial syllable as a short token.
    // We require more shared context here than for an explicit dashed restart.
    if ((!explicit && (!unmarked.test(gaps[fragment]!) || !/^[a-z]{2,3}$/u.test(tokens[fragment]!.text)
      || completeFragments.has(tokens[fragment]!.key)))
      || !/^[a-z’']+$/iu.test(tokens[fragment]!.text)
      || emphasis.has(tokens[fragment]!.key)
      || ["a", "i", "no", "not", "can", "cannot", "do", "did", "go", "will", "is", "are", "was", "were", "have", "has"].includes(tokens[fragment]!.key)) continue;
    const second = fragment + 1;
    const maxLength = Math.min(fragment + 1, runEnd[second]! - second);
    for (let length = maxLength; length >= 2; length--) {
      const first = second - length, end = second + length;
      const firstLast = tokens[fragment]!.key, secondLast = tokens[end - 1]!.key;
      const auxiliary = tokens[fragment - 1]!.key === "not" ? tokens[fragment - 2]?.key : tokens[fragment - 1]!.key;
      if (!explicit && (length < 3 || !fragmentAuxiliaries.has(auxiliary ?? "")
        || !/^[a-z][a-z’']*$/u.test(tokens[end - 1]!.text))) continue;
      if (runEnd[first]! < fragment + 1 || protectedEcho(first, length)
        || !safeRange(first, end) || firstLast.length >= secondLast.length || !secondLast.startsWith(firstLast)
        || /^[A-Z][a-z]+$/u.test(tokens[fragment]!.text) && /^[A-Z][a-z]+$/u.test(tokens[end - 1]!.text)
        || !tokens.slice(first, fragment).every((token, offset) => token.key === tokens[second + offset]!.key)) continue;
      return text.slice(0, tokens[fragment]!.start) + text.slice(tokens[end - 1]!.start);
    }
  }

  // A comma/dash restart followed by shorter copies of the same prefix and
  // then a continued full copy supplies stronger evidence than two complete
  // sentences. A conjunction joining identical clauses also marks a restart,
  // including at the end of a draft; different adversative clauses stay intact.
  for (let first = 0; first < count - 4; first++) {
    const firstEnd = runEnd[first]!, length = firstEnd - first;
    if (length < 2 || firstEnd >= count || !restart.test(gaps[firstEnd - 1]!)
      || protectedEcho(first, length) || !safeRange(first, firstEnd)) continue;
    let next = firstEnd, hadShortAttempt = false;
    const redundantConjunction = tokens[next]!.key === "but" && next + 1 < count && white.test(gaps[next]!);
    if (redundantConjunction) next++;
    while (next < count) {
      let shared = 0;
      while (shared < length && next + shared < count && safe[next + shared]
        && tokens[first + shared]!.key === tokens[next + shared]!.key
        && (shared === 0 || white.test(gaps[next + shared - 1]!))) shared++;
      if (shared === length) {
        const last = next + shared - 1;
        if (redundantConjunction && !hadShortAttempt || hadShortAttempt && last + 1 < count && white.test(gaps[last]!))
          return text.slice(0, tokens[firstEnd - 1]!.end) + text.slice(tokens[last]!.end);
        break;
      }
      if (shared === 0 || next + shared >= count || !shortRestart.test(gaps[next + shared - 1]!)) break;
      // Single-word hesitations may occur in the chain, but at least one
      // longer matching prefix is required before any clause is removed.
      hadShortAttempt ||= shared >= 2;
      next += shared;
    }
  }
  return text;
}
