/** Local value corrections only; no summarizing or generated wording. */
type Token = { word: string; key: string; start: number; end: number };
const words = (text: string): Token[] => [...text.matchAll(/[\p{L}\p{N}]+(?:[’'][\p{L}]+)*/gu)]
  .map(m => ({ word: m[0], key: m[0].toLowerCase().replaceAll("’", "'"), start: m.index, end: m.index + m[0].length }));
const unsafe = /[`"“”‘]|(?<![\p{L}])['][^'\n]*['](?![\p{L}])|\S*[/\\_]\S*|\S*\.[A-Za-z0-9]\S*|\b(?:spell|literal|verbatim|say|type|write|repeat|list|not|never|cannot|without|hardly|except|only|maybe|probably|possibly|perhaps|think|hope|if|unless|because|although|but|and|or)\b|\b\w+['’]t\b/iu;
const temporal = /\b(?:today|yesterday|tomorrow|now|then|later|earlier|previously|formerly|afterwards|before|after|on|at|in|during|since|until|by|for|former|current)\b/iu;
const copulaGroup = (word: string): string => ["is", "was", "am"].includes(word) ? "singular" : ["are", "were"].includes(word) ? "plural" : word;

function proposition(sentence: string): { subject: string; copula: string; predicate: string; offset: number } | null {
  if (unsafe.test(sentence) || sentence.length > 600) return null;
  const expanded = sentence.match(/^((?:it|he|she|that|this)['’]s|(?:we|you|they)['’]re|i['’]m)\s+(.+?)(?:[.!?]\s*)?$/iu);
  const plain = expanded ? null : sentence.match(/^([\p{L}][\p{L}’']*(?:\s+[\p{L}][\p{L}’']*){0,4})\s+(is|was|are|were|am)\s+(.+?)(?:[.!?]\s*)?$/iu);
  if (!expanded && !plain) return null;
  const subject = expanded ? expanded[1]!.split(/[’']/u)[0]!.toLowerCase() : plain![1]!.toLowerCase().replace(/\s+/gu, " ");
  if (/^(?:who|what|when|where|why|how|which)\b/iu.test(subject)) return null;
  const copula = expanded ? /['’]s$/iu.test(expanded[1]!) ? "is" : /['’]re$/iu.test(expanded[1]!) ? "are" : "am" : plain![2]!.toLowerCase();
  const predicate = (expanded?.[2] ?? plain?.[3])!;
  // Retain the original confirmation tag, but do not interpret it as a value.
  const value = predicate.replace(/,\s*right\s*\??$/iu, "");
  if (/[^\p{L}\p{N}’\x27\p{White_Space}]/u.test(value) || !value || words(value).length > 8) return null;
  return { subject, copula, predicate: value, offset: sentence.indexOf(predicate, expanded ? expanded[1]!.length : plain![1]!.length + plain![2]!.length) };
}

/** Match one changed lexical value in adjacent, same-subject propositions.
 * Explicit No/Oh no marks the correction. Extra facts, qualifiers, polarity,
 * literals and temporal contrasts remain unchanged. All surrounding bytes stay. */
export function resolveCopularCorrections(original: string): { text: string; count: number } {
  if (uncertainLiteral(original)) return { text: original, count: 0 };
  let text = original, count = 0;
  for (let pass = 0; pass < 6; pass++) {
    const boundaries = [0, ...[...text.matchAll(/(?<=[.!?])\s+(?=\S)/gu)].map(m => m.index + m[0].length), text.length];
    const literals = literalRanges(text);
    let changed = false;
    for (let i = 1; i < boundaries.length - 1; i++) {
      const start = boundaries[i]!, end = boundaries[i + 1]!;
      const marker = text.slice(start, end).trimEnd().match(/^(?:oh[,\s]+)?no(?:[,\s!]+)(.*)$/iu);
      if (!marker) continue;
      let correction = marker[1]!.replace(/^(?:actually|wait)[,\s]+/iu, ""), correctionEnd = end;
      if (!correction.trim() && i + 2 < boundaries.length) {
        correctionEnd = boundaries[i + 2]!;
        correction = text.slice(end, correctionEnd).trim();
      }
      if (/\?/u.test(correction)) continue;
      const beforeStart = boundaries[i - 1]!, before = text.slice(beforeStart, start).trimEnd();
      if (i > 1 && literalInstruction(text.slice(boundaries[i - 2]!, beforeStart))) continue;
      if (literals.some(m => beforeStart < m.end && correctionEnd > m.start)) continue;
      const a = proposition(before), b = proposition(correction);
      if (!a || !b || a.subject !== b.subject || copulaGroup(a.copula) !== copulaGroup(b.copula)
        || a.copula !== b.copula && temporal.test(a.predicate + " " + b.predicate)) continue;
      const left = words(a.predicate), right = words(b.predicate);
      if ([left, right].some(tokens => tokens.some(t => /^[A-Z]{2,}$/u.test(t.word)))) continue;
      // Compare the lexical value separately from article choice. The
      // original subject, tense and confirmation tag remain unchanged.
      if (["a", "an", "the"].includes(left[0]?.key ?? "")) left.shift();
      if (["a", "an", "the"].includes(right[0]?.key ?? "")) right.shift();
      if (!left.length || left.length !== right.length
        || a.copula !== b.copula && left.length < 2) continue;
      const differing = left.map((t, index) => t.key !== right[index]!.key ? index : -1).filter(index => index >= 0);
      if (differing.length !== 1) continue;
      const index = differing[0]!, from = left[index]!, to = right[index]!;
      if (from.word.length > 80 || to.word.length > 80 || a.offset < 0) continue;
      // Copy only the corrected complement, including its article when needed
      // for grammar (an orange box -> a silver box). Preserve every surrounding
      // word, including independent confirmation sentences.
      const updated = before.slice(0, a.offset) + b.predicate + before.slice(a.offset + a.predicate.length);
      const trailing = text.slice(start, correctionEnd).match(/\s*$/u)?.[0] ?? "";
      text = text.slice(0, beforeStart) + updated + trailing + text.slice(correctionEnd);
      count++; changed = true; break;
    }
    if (!changed) break;
  }
  return { text, count };
}


function literalRanges(text: string): { start: number; end: number }[] {
  return [...text.matchAll(/```[\s\S]*?```|`[^`]*`|"[^"]*"|“[^”]*”|\S*[/\\_]\S*|\S*\.[A-Za-z0-9]\S*/gu)]
    .map(m => ({ start: m.index, end: m.index + m[0].length }));
}


function literalInstruction(previous: string): boolean {
  return /\b(?:say|type|write|repeat|spell|read|quote)\b[^.!?]*\b(?:following|exactly|verbatim|literal|text|words)\b/iu.test(previous);
}

function uncertainLiteral(original: string): boolean {
  // Work on ordinary dictation only, including when a quotation contains
  // several sentences and neither adjacent sentence carries its quote marks.
  return Boolean((original.match(/`/gu)?.length ?? 0) % 2 || (original.match(/"/gu)?.length ?? 0) % 2
    || (original.match(/“/gu)?.length ?? 0) !== (original.match(/”/gu)?.length ?? 0)
    // A possessive apostrophe and a quote boundary are textually ambiguous.
    // Single-quoted passages therefore keep the whole original fast-path text.
    // Apostrophes within ordinary contractions do not trigger this fallback.
    || /‘|(?<![\p{L}\p{N}])[’']/u.test(original));
}

/** Keep the final confirmed fact of a redundant local question/answer chain.
 * No generated facts, global summarizing, or model calls are involved. */
export function collapseConfirmationChains(original: string): { text: string; count: number } {
  if (uncertainLiteral(original)) return { text: original, count: 0 };
  let text = original, count = 0;
  for (let pass = 0; pass < 6; pass++) {
    const boundaries = [0, ...[...text.matchAll(/(?<=[.!?])\s+(?=\S)/gu)].map(m => m.index + m[0].length), text.length];
    const literals = literalRanges(text);
    let changed = false;
    for (let i = 0; i < boundaries.length - 3; i++) {
      const start = boundaries[i]!, end = boundaries[i + 3]!;
      if (i > 0 && literalInstruction(text.slice(boundaries[i - 1]!, start))) continue;
      if (literals.some(range => start < range.end && end > range.start)) continue;
      const question = text.slice(start, boundaries[i + 1]!).trimEnd();
      if (!/,\s*(?:right|correct)\s*\?$/iu.test(question)) continue;
      const ack = text.slice(boundaries[i + 1]!, boundaries[i + 2]!).trim();
      if (!/^(?:(?:you['’]re|you\s+are|that['’]s|that\s+is)(?:\s*,\s*|\s+)(?:right|correct)|exactly|correct)\.?$/iu.test(ack)) continue;
      const finalSentence = text.slice(boundaries[i + 2]!, end);
      const body = finalSentence.trimEnd().replace(/^(?:yeah|yes|yep|indeed)(?:\s*,\s*|\s+)/iu, "");
      const a = proposition(question.replace(/,\s*(?:right|correct)\s*\?$/iu, ".")), b = proposition(body);
      if (!a || !b || /[?!]/u.test(body) || a.subject !== b.subject || copulaGroup(a.copula) !== copulaGroup(b.copula)
        || temporal.test(a.predicate + " " + b.predicate)) continue;
      const value = (predicate: string) => {
        const keys = words(predicate).map(token => token.key);
        if (["a", "an", "the"].includes(keys[0] ?? "")) keys.shift();
        return keys;
      };
      if ([...words(a.predicate), ...words(b.predicate)].some(token => /^[A-Z]{2,}$/u.test(token.word))) continue;
      const left = value(a.predicate), right = value(b.predicate);
      if (!left.length || left.length !== right.length || left.some((key, index) => key !== right[index])) continue;
      const acknowledgement = ack.replace(/\.$/u, "").replace(/,\s*/gu, " ").replace(/\s+/gu, " ");
      const heading = acknowledgement[0]!.toUpperCase() + acknowledgement.slice(1);
      // Lower only a closed-class sentence-initial pronoun/article, never a name.
      const clause = body.replace(/^(?:It|He|She|They|You|We|The|This|That|These|Those|Our|My|Your)\b/u, word => word.toLowerCase());
      const trailing = finalSentence.match(/\s*$/u)?.[0] ?? "";
      text = text.slice(0, start) + heading + ", " + clause + trailing + text.slice(end);
      count++; changed = true; break;
    }
    if (!changed) break;
  }
  return { text, count };
}


/** Infer a narrow last-version repair in initial cleaned dictation.
 * A repeated deictic, copular scaffold plus one revised ending can be an
 * ASR-normalized false start. It can also be intentional; retain raw and let
 * callers make this heuristic optional. No acoustic certainty is implied.
 * The surviving clause is copied verbatim, never generated or paraphrased. */
export function collapseRevisedClauseRestarts(original: string): { text: string; count: number } {
  if (uncertainLiteral(original)) return { text: original, count: 0 };
  const scaffold = new Set(["just", "simply", "merely"]);
  const numberWords = new Set("zero nought one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion first second third fourth fifth sixth seventh eighth ninth tenth dozen half quarter double triple".split(" "));
  const contrast = /\b(?:however|whereas|yet|rather|instead|different|respectively|alternatively|another|both|each|either|neither|also|additionally|separately|else)\b/iu;
  const uncertain = /\b(?:possible|probable|plausible|likely|unlikely|potential|potentially|apparent|apparently|presumed|presumably|alleged|allegedly|estimated|approximate|approximately|roughly)\b/iu;
  const instruction = /^(?:please\s+)?(?:say|type|write|repeat|spell|read|quote|list)\b|\b(?:first|second|third|next|another|other|also|additionally|separately|alternatively|each|both|either|neither|items?|examples?)\b/iu;
  const clarified = collapseClarifiedActionRestarts(original);
  let text = clarified.text, count = clarified.count;
  for (let pass = 0; pass < 6; pass++) {
    const boundaries = [0, ...[...text.matchAll(/(?<=[.!?])\s+(?=\S)/gu)].map(m => m.index + m[0].length), text.length];
    const literals = literalRanges(text);
    let changed = false;
    for (let i = 0; i < boundaries.length - 2; i++) {
      const start = boundaries[i]!, second = boundaries[i + 1]!, end = boundaries[i + 2]!;
      const firstSentence = text.slice(start, second), finalSentence = text.slice(second, end);
      const before = firstSentence.trimEnd(), after = finalSentence.trimEnd();
      // A paragraph break, question or exclamation supplies no restart cue.
      if (!before.endsWith(".") || /[!?]/u.test(before + after)
        || !/^[ \t]+$/u.test(firstSentence.slice(before.length))) continue;
      const previous = i > 0 ? text.slice(boundaries[i - 1]!, start).trim() : "";
      if (literalInstruction(previous) || instruction.test(previous)
        || literals.some(range => start < range.end && end > range.start)) continue;
      const a = proposition(before), b = proposition(after);
      if (!a || !b || !["it", "this", "that"].includes(a.subject)
        || a.subject !== b.subject || a.copula !== b.copula
        || temporal.test(a.predicate + " " + b.predicate)
        || contrast.test(a.predicate + " " + b.predicate)
        || uncertain.test(a.predicate + " " + b.predicate)) continue;
      const left = words(a.predicate), right = words(b.predicate);
      // Expanded subject + copula + common predicate prefix must contain at
      // least four tokens. The hedge is structural evidence, not a noun list.
      if (left.length < 3 || left.length !== right.length || !scaffold.has(left[0]!.key)
        || !left.slice(0, -1).every((token, index) => token.key === right[index]!.key)) continue;
      const from = left.at(-1)!, to = right.at(-1)!;
      if (from.key === to.key || [...left, ...right].some(token =>
        !/^[a-z]+$/u.test(token.word) || numberWords.has(token.key))) continue;
      text = text.slice(0, start) + finalSentence + text.slice(end);
      count++; changed = true; break;
    }
    if (!changed) break;
  }
  return { text, count };
}

/** Three adjacent attempts identify an object refinement: an action on an
 * object, its standalone possessive clarification, then the same action on
 * that clarified object. Preserve the first scaffold/qualifiers and copy the
 * final object's entire continuation. This is not general summarization. */
export function collapseClarifiedActionRestarts(original: string): { text: string; count: number } {
  if (uncertainLiteral(original)) return { text: original, count: 0 };
  const protectedContext = /\b(?:not|never|cannot|without|maybe|probably|possibly|perhaps|hope|if|unless|also|instead|separately|both|each|spell|literal|verbatim|say|type|write|repeat|list)\b|\b\w+['’]t\b|\p{N}/iu;
  const subject = new Set(["i", "we", "you", "they"]), modals = new Set(["should", "could", "can", "will", "would", "must", "might"]);
  const leadKey = (items: Token[]): string | null => {
    const keys = items.map(token => token.key);
    if (["anyway", "well", "so", "okay"].includes(keys[0] ?? "")) keys.shift();
    if (keys.length === 3 && keys[1] === "think" && keys[2] === "that") keys.pop();
    return !keys.length || keys.length === 2 && ["i", "we"].includes(keys[0]!) && keys[1] === "think" ? keys.join(" ") : null;
  };
  let text = original, count = 0;
  for (let pass = 0; pass < 6; pass++) {
    const boundaries = [0, ...[...text.matchAll(/(?<=[.!?])\s+(?=\S)/gu)].map(match => match.index + match[0].length), text.length];
    const literals = literalRanges(text);
    let changed = false;
    for (let i = 0; i < boundaries.length - 3; i++) {
      const start = boundaries[i]!, middle = boundaries[i + 1]!, final = boundaries[i + 2]!, end = boundaries[i + 3]!;
      const firstSentence = text.slice(start, middle), fragmentSentence = text.slice(middle, final), finalSentence = text.slice(final, end);
      const window = firstSentence + fragmentSentence + finalSentence;
      if (window.length > 1_200 || /[!?\n\r]/u.test(window) || protectedContext.test(window)
        || !firstSentence.trimEnd().endsWith(".") || !fragmentSentence.trimEnd().endsWith(".")
        || literals.some(range => start < range.end && end > range.start)) continue;
      if (i > 0) {
        const previous = text.slice(boundaries[i - 1]!, start);
        if (literalInstruction(previous) || /^(?:please\s+)?(?:say|type|write|repeat|spell|read|quote|list)\b|\b(?:items|examples|statements)\b/iu.test(previous)) continue;
      }
      const a = words(firstSentence), fragment = words(fragmentSentence), b = words(finalSentence);
      const possessive = fragment.findIndex(token => token.key.endsWith("'s"));
      // Require a determiner and a single possessive refinement, not a clause,
      // person's proper name, contrast, list, quantity, or arbitrary new fact.
      if (possessive < 1 || fragment.length < possessive + 2 || fragment.length > 8
        || !["the", "a", "an", "our", "your", "their", "my"].includes(fragment[0]?.key ?? "")
        || !/^[\p{L}’'\s.]+$/u.test(fragmentSentence)
        || fragment.slice(1).some(token => !/^[a-z]+(?:['’]s)?$/u.test(token.word)
          || subject.has(token.key) || modals.has(token.key))) continue;
      const oldObject = fragment.slice(0, possessive + 1).map(token => token.key.replace(/'s$/u, ""));
      const objectAt = a.length - oldObject.length;
      if (objectAt < 3 || !oldObject.every((key, at) => a[objectAt + at]?.key === key)
        || a.slice(objectAt + 1).some(token => !/^[a-z]+$/u.test(token.word))) continue;
      const targetIndices = b.flatMap((_, at) => fragment.every((token, offset) => b[at + offset]?.key === token.key) ? [at] : []);
      if (targetIndices.length !== 1) continue;
      const target = targetIndices[0]!;
      const leftPrefix = a.slice(0, objectAt), rightPrefix = b.slice(0, target);
      const coreAt = leftPrefix.findIndex((token, at) => subject.has(token.key) && modals.has(leftPrefix[at + 1]?.key ?? ""));
      const otherCoreAt = rightPrefix.findIndex((token, at) => subject.has(token.key) && modals.has(rightPrefix[at + 1]?.key ?? ""));
      if (coreAt < 0 || otherCoreAt < 0) continue;
      const leftCore = leftPrefix.slice(coreAt), rightCore = rightPrefix.slice(otherCoreAt);
      const lead = leadKey(leftPrefix.slice(0, coreAt)), otherLead = leadKey(rightPrefix.slice(0, otherCoreAt));
      if (lead === null || lead !== otherLead || leftCore.length < 3 || leftCore.length !== rightCore.length
        || !leftCore.every((token, at) => token.key === rightCore[at]?.key)
        || leftCore.some(token => token.word !== "I" && !/^[a-z]+$/u.test(token.word) && token !== leftCore[0])) continue;
      text = text.slice(0, start) + firstSentence.slice(0, a[objectAt]!.start) + finalSentence.slice(b[target]!.start) + text.slice(end);
      count++; changed = true; break;
    }
    if (!changed) break;
  }
  return { text, count };
}
