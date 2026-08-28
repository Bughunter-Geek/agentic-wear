# Roadmap

Agentic Wear is built in the open. The order is deliberate: a wrist companion
must be dependable before it becomes broad.

## Reliable core

- One alert per final top-level turn, including failed and interrupted turns.
- Background delivery through a content-free Firebase wake and encrypted inbox.
- Push-to-talk, session selection, safe approval boundaries, and signed OTA updates.

## Next

- A compact conversation view with the latest user and agent messages.
- A recent-sessions tile backed by the watch's encrypted local cache.
- An active-session complication that remains useful without holding a socket open.

## Deliberate non-goals

- No unauthenticated LAN bridge or blanket auto-approval mode.
- No file-modification timestamps as a proxy for completed turns.
- No quota scraping through undocumented account endpoints. Quota surfaces can be
  added when an official supported API exists.

See [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) for prior art and inspiration.
