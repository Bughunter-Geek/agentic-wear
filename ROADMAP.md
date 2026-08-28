# Roadmap

Agentic Wear is built in the open. The order is deliberate: a wrist companion
must be dependable before it becomes broad.

## Reliable core

- One alert per final top-level turn, including failed and interrupted turns.
- Background delivery through a content-free Firebase wake and encrypted inbox.
- Tap-to-toggle voice capture, session selection, safe approval boundaries, and signed OTA updates.

## Alpha 0.3 — live sessions

- Stream the active Codex conversation into a compact, crown-scrollable watch view.
- Follow agent output while a run is active without turning intermediate reasoning into completion alerts.
- Intervene from the watch while work is running.
- Queue a follow-up for the next turn or steer the active run when the supported Codex API exposes that distinction.
- Keep completion, permission, interruption, and failure alerts deduplicated across the live view and background delivery.

## Later

- A compact conversation view with the latest user and agent messages.
- A recent-sessions tile backed by the watch's encrypted local cache.
- An active-session complication that remains useful without holding a socket open.

## Deliberate non-goals

- No unauthenticated LAN bridge or blanket auto-approval mode.
- No file-modification timestamps as a proxy for completed turns.
- No quota scraping through undocumented account endpoints. Quota surfaces can be
  added when an official supported API exists.

See [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) for prior art and inspiration.
