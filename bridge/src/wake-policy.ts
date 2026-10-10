/** Bulk state the watch fetches on its next inbox fetch; it never needs a high-priority wake push for these. */
const QUIET_KINDS: ReadonlySet<string> = new Set(["chat.snapshot", "sessions.snapshot"]);

/** Pure decision: false only for the exact quiet kinds. Everything else (including unknown kinds) wakes. */
export function shouldWakeWatch(kind: unknown): boolean {
  return typeof kind !== "string" || !QUIET_KINDS.has(kind);
}
