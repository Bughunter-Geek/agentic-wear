type Token = { key: string; word: string; start: number; end: number };
const tokens = (text: string): Token[] => [...text.matchAll(/[\p{L}\p{N}]+(?:[’'][\p{L}]+)*/gu)]
  .map(m => ({ key: m[0].toLowerCase().replaceAll("’", "'"), word: m[0], start: m.index, end: m.index + m[0].length }));
const unsafe = /[`"“”‘]|(?<![\p{L}\p{N}])[’']|\S*[/\\_]\S*|\S*\.[A-Za-z0-9]\S*|\b(?:spell|literal|verbatim|say|type|write|repeat|list)\b/iu;
const uncertain = /\b(?:not|never|cannot|without|hardly|except|only|maybe|probably|possibly|perhaps|hope|think|if|unless|yesterday|today|tomorrow|now|then|later|earlier|previously|before|after)\b|\b\w+['’]t\b/iu;
const prohibition = /\b(?:not|never|cannot|without|mustn[’']t)\b|\b\w+[’']t\b/iu;
const articles = new Set(["a", "an", "the"]);
// ASR sentence punctuation is not a reliable boundary: a cue may be inline,
// comma separated or split into "No. Actually," / "No, wait. It ...".
const cuePattern = /(?:\boh[,;:.!?\s–—-]+)?\bno[,;:.!?\s–—-]+(?:(?:actually|wait)\b[,;:.!?\s–—-]*|(?=[\p{L}]+\s+(?:it|them)\s+))/giu;
type Cue = { start: number; bodyStart: number; inline: boolean; split: boolean };
const skipNames = ["literal", "noPreviousClause", "unsupportedFrame", "unsafePredicate", "protectedContext", "ambiguousTarget"] as const;
type SkipName = typeof skipNames[number];
export type ExplicitCorrectionDiagnostics = {
  version: "explicit-align-3";
  cueCount: number; inlineCueCount: number; splitCueCount: number;
  resolvedCount: number; remainingCueCount: number;
  skips: Record<SkipName, number>;
};
function cues(text: string): Cue[] {
  return [...text.matchAll(cuePattern)].map(match => ({ start: match.index, bodyStart: match.index + match[0].length,
    inline: !/[.!?]\s*$/u.test(text.slice(0, match.index)), split: /[.!?]/u.test(match[0]) }));
}
function predicateSafe(value: string): boolean {
  return Boolean(value.trim()) && value.length <= 240 && !unsafe.test(value) && !uncertain.test(value)
    && !tokens(value).some(token => /\p{N}/u.test(token.word) || /^[A-Z]/u.test(token.word));
}
function splitAddition(text: string): { main: string; addition: string } {
  const at = /(?:,\s*|\s+)(?:and|but|because|while|although)\b/iu.exec(text);
  return at ? { main: text.slice(0, at.index).trimEnd(), addition: text.slice(at.index) }
    : { main: text.replace(/[.,;:–—-]+$/u, "").trimEnd(), addition: "" };
}
function frame(text: string): { keys: string[]; subject: string; predicate: string; kind: "copular" | "imperative" } | null {
  const match = text.match(/^([\p{L}][\p{L}’']*(?:\s+[\p{L}][\p{L}’']*){0,3})\s+(is|was|are|were|am)\s+(.+)$/iu);
  if (!match) {
    // A repeated action + object anchor identifies a local value correction:
    // make it pink. No, make it green. No action or noun vocabulary list.
    const action = text.match(/^([\p{L}]+)\s+(it|them)\s+(.+)$/iu);
    return action ? { keys: tokens(action[1]! + " " + action[2]!).map(token => token.key),
      subject: action[2]!.toLowerCase(), predicate: action[3]!, kind: "imperative" } : null;
  }
  return { keys: tokens(match[1]! + " " + match[2]!).map(token => token.key),
    subject: match[1]!.toLowerCase(), predicate: match[3]!, kind: "copular" };
}
function previousSentenceStart(text: string, cueStart: number): number {
  const boundaries = [0, ...[...text.slice(0, cueStart).matchAll(/(?<=[.!?])\s+(?=\S)/gu)].map(match => match.index + match[0].length)];
  return boundaries.at(-1)!;
}
function correctionEnd(text: string, mark: Cue, next?: Cue): number {
  const end = /[.!?](?:\s+(?=\S)|\s*$)/u.exec(text.slice(mark.bodyStart));
  return Math.min(end ? mark.bodyStart + end.index + end[0].length : text.length, next?.start ?? text.length);
}

/** Apply explicit local corrections by matching their subject/predicate or a
 * unique noun phrase with one changed value. Cue boundaries do not depend on
 * ASR punctuation. Added facts are copied verbatim; uncertain targets remain.
 * Diagnostics contain counts/categories only, never transcript words. */
export function resolveExplicitClauseCorrections(original: string, onDiagnostics?: (value: ExplicitCorrectionDiagnostics) => void): { text: string; count: number } {
  const initial = cues(original);
  const diagnostics: ExplicitCorrectionDiagnostics = { version: "explicit-align-3", cueCount: initial.length,
    inlineCueCount: initial.filter(mark => mark.inline).length, splitCueCount: initial.filter(mark => mark.split).length,
    resolvedCount: 0, remainingCueCount: initial.length, skips: Object.fromEntries(skipNames.map(key => [key, 0])) as Record<SkipName, number> };
  const finish = (text: string, count: number) => {
    diagnostics.resolvedCount = count; diagnostics.remainingCueCount = cues(text).length;
    onDiagnostics?.(diagnostics); return { text, count };
  };
  if (unsafe.test(original)) { diagnostics.skips.literal = initial.length; return finish(original, 0); }
  let text = original, count = 0;
  for (let pass = 0; pass < 6; pass++) {
    for (const name of skipNames) diagnostics.skips[name] = 0;
    const marks = cues(text);
    let changed = false;
    for (const [i, mark] of marks.entries()) {
      const start = mark.start, end = correctionEnd(text, mark, marks[i + 1]);
      const beforeStart = previousSentenceStart(text, start);
      const beforeWithSeparator = text.slice(beforeStart, start).trimEnd();
      const before = beforeWithSeparator.replace(/[.,;:\s–—-]+$/u, "");
      const body = text.slice(mark.bodyStart, end).trimEnd();
      if (!before || before.length > 600 || !body) { diagnostics.skips.noPreviousClause++; continue; }
      if (/[?!]$/u.test(beforeWithSeparator) || /[?!]/u.test(body) || prohibition.test(before)) {
        diagnostics.skips.protectedContext++; continue;
      }
      const { main, addition } = splitAddition(body), incoming = frame(main);
      if (!incoming) { diagnostics.skips.unsupportedFrame++; continue; }
      if (!predicateSafe(incoming.predicate)) { diagnostics.skips.unsafePredicate++; continue; }
      const previous = tokens(before), incomingKeys = incoming.keys;
      const matchingFrames: number[] = [];
      for (let at = 0; at + incomingKeys.length < previous.length; at++) {
        if (incomingKeys.every((key, offset) => key === previous[at + offset]!.key)) matchingFrames.push(at);
      }
      let updated: string | null = null;
      if (matchingFrames.length === 1) {
        const at = matchingFrames[0]!, predicateStart = previous[at + incomingKeys.length]!.start;
        const oldPredicate = before.slice(predicateStart);
        const left = tokens(oldPredicate), right = tokens(incoming.predicate);
        if (incoming.kind === "imperative" && (left.length !== right.length || left.length > 6
          || left.filter((token, offset) => token.key !== right[offset]?.key).length !== 1)) {
          diagnostics.skips.ambiguousTarget++; continue;
        }
        // A second coordinated action may be an independent fact. Retain it.
        if (predicateSafe(oldPredicate) && !/\b(?:and|or|but|because|while|although)\b/iu.test(oldPredicate)) {
          updated = before.slice(0, predicateStart) + incoming.predicate;
        }
      } else if (matchingFrames.length === 0 && incoming.kind === "copular" && ["it", "this", "that"].includes(incoming.subject)) {
        const value = tokens(incoming.predicate), candidates: { start: number; end: number }[] = [];
        if (value.length >= 2 && value.length <= 8 && !value.some(token => /^[A-Z]/u.test(token.word))) {
          for (let at = 0; at + value.length <= previous.length; at++) {
            const window = previous.slice(at, at + value.length);
            if (window.at(-1)!.key !== value.at(-1)!.key) continue;
            const differences = window.filter((token, offset) => token.key !== value[offset]!.key
              && !(offset === 0 && articles.has(token.key) && articles.has(value[0]!.key))).length;
            const old = before.slice(window[0]!.start, window.at(-1)!.end);
            if (differences !== 1 || !predicateSafe(old) || window.some(token => /^[A-Z]/u.test(token.word))) continue;
            candidates.push({ start: window[0]!.start, end: window.at(-1)!.end });
          }
          if (candidates.length === 1) {
            const candidate = candidates[0]!;
            updated = before.slice(0, candidate.start) + incoming.predicate + before.slice(candidate.end);
          }
        }
      }
      if (updated === null) { diagnostics.skips.ambiguousTarget++; continue; }
      // Preserve the correction's punctuation and any added facts. When a
      // second cue is inline, its comma/space boundary is preserved too.
      updated += addition || body.match(/[.,;:–—-]+$/u)?.[0] || "";
      const trailing = text.slice(start, end).match(/\s*$/u)?.[0] ?? "";
      text = text.slice(0, beforeStart) + updated + trailing + text.slice(end);
      count++; changed = true; break;
    }
    if (!changed) break;
  }
  return finish(text, count);
}
