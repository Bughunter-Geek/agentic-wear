# Realtime voice foundation (Alpha 0.6, unreleased)

Agentic Wear's released voice path is deliberately half-duplex:

1. The watch records an encrypted AAC payload for its paired bridge.
2. The bridge transcribes it locally.
3. The bridge submits the resulting text as a normal Codex App Server turn.

The bridge does not claim GPT-Live support and does not substitute a made-up model ID.

## Runtime evidence

A direct `codex app-server` probe on the bridge host's Codex CLI `0.147.0`
accepted these experimental methods:

- `thread/realtime/start`
- `thread/realtime/appendAudio`
- `thread/realtime/appendText`
- `thread/realtime/appendSpeech`
- `thread/realtime/stop`
- `thread/realtime/listVoices`

`thread/realtime/listVoices` returned voice catalogs, including `cove` and
`marin`. This proves only that the App Server exposes an experimental realtime
surface; it does not grant a GPT-Live model or establish a supported watch
transport.

The same live `model/list` response contained GPT-5.6, GPT-5.5, GPT-5.4, and
configured provider models, but no `gpt-live-1` model. `thread/queue/add` was
rejected as an unknown method by that runtime. GPT-Live-1's ChatGPT rollout is
therefore not treated as an API/App Server entitlement.

## Foundation and blocker

At bridge startup, `AppServerClient.realtimeVoiceCapability()` performs only the
non-mutating `thread/realtime/listVoices` and `model/list` checks. It reports a
specific blocker: incompatible realtime API, unavailable model catalog, absent
exact `gpt-live-1` catalog ID, or missing reviewed watch transport. The
capability remains disabled even if the catalog later contains that ID: a model
entry alone cannot enable a new microphone transport. It never calls
`thread/realtime/start`, sends microphone audio to the realtime route, or
changes model/effort/approval behavior.

For the verified 0.147.0 runtime, the blocker is **absent GPT-Live-1 catalog
ID**: `gpt-live-1` is not in the model catalog. A cataloged,
bridge-authorized GPT-Live-1 model plus a separately reviewed full-duplex watch
protocol remain required. That protocol must preserve the current encrypted
pairing, explicit approvals, duplicate suppression, and Wear performance
constraints.

## Foreign session behavior

The App Server's active-writer protection means another Codex client currently
owns the session's live turn. The bridge safely rejoins idle foreign sessions,
but it neither interrupts active foreign turns nor has server-side queue support
in 0.147.0. On an active writer, the watch retains its editable draft and tells
the user that it was not queued or sent; the user retries after the current
turn finishes.
