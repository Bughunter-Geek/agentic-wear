# Roadmap

Agentic Wear is built in the open. The order is deliberate: a wrist companion
must be dependable before it becomes broad.

## Reliable core

- One alert per final top-level turn, including failed and interrupted turns.
- Background delivery through a content-free Firebase wake and encrypted inbox.
- Tap-to-toggle voice capture, session selection, safe approval boundaries, and signed OTA updates.

## Alpha 0.3 — live sessions (delivered in Alpha 0.4)

- [x] Stream the active Codex conversation into a compact, crown-scrollable watch view.
- [x] Follow agent output while a run is active without turning intermediate reasoning into completion alerts.
- [x] Intervene with `turn/steer` when Codex marks the active turn as directly steerable.
- [x] Keep completion, permission, interruption, and failure alerts deduplicated across the live view and background delivery.
- [ ] Queue a follow-up for the next turn when the supported Codex App Server exposes a queue operation. Codex 0.147 exposes steering, but no queue request.

## Alpha 0.4 — semantic voice revisions (delivered)

- [x] Let a user revise the same unsent prompt with another dictation from transcript review.
- [x] Treat newer speech as corrections: replace conflicting older facts or requirements while preserving unrelated instructions.
- [x] Return one editable reconciled draft instead of appending contradictory text.
- [x] Preserve the previous draft intact if semantic reconciliation is unavailable or fails.

## Later

- Optional user-message context in the compact conversation view.
- A recent-sessions tile backed by the watch's encrypted local cache.
- An active-session complication that remains useful without holding a socket open.

## Deliberate non-goals

- No unauthenticated LAN bridge or blanket auto-approval mode.
- No file-modification timestamps as a proxy for completed turns.
- No quota scraping through undocumented account endpoints. Quota surfaces can be
  added when an official supported API exists.

See [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) for prior art and inspiration.
