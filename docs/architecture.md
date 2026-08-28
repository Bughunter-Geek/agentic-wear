# Architecture

## Wear app

The standalone Wear OS app records push-to-talk audio, encrypts bridge requests, displays session/alert state, and fetches an encrypted inbox after a high-priority FCM wake. It posts notifications even while its activity is foregrounded. Completion uses a one-second vibration; permissions and failures use distinct patterns.

Android Keystore holds the non-exportable P-256 watch key and the AES key that protects the relay credential at rest.

## Relay

The Cloudflare Worker keeps one fixed SQLite-backed admission Durable Object in front of the per-pair objects. Public completion attempts are edge-rate-limited, pass an exact relay-wide attempt budget, and must match an unexpired ID registered by the bootstrap-authenticated start route before the Worker resolves a per-pair object. The admission set is bounded and expires automatically.

Each admitted pairing then uses one SQLite-backed Durable Object. It stores credential hashes, endpoint public keys and proofs, the Firebase Installation ID, and a bounded ciphertext inbox. It uses a hibernatable authenticated WebSocket for the bridge. Protocol-v1 records fail closed and must be replaced.

Watch-to-bridge traffic is live-only. This deliberately trades offline voice-command queuing for lower privacy risk: when the bridge is offline, the watch reports the failure, deletes the temporary recording, and asks the user to record again later.

## macOS bridge

The bridge:

- Connects to the managed Codex App Server’s local Unix WebSocket.
- Subscribes to loaded sessions and reconciles their persisted terminal turns every 20 seconds.
- Emits one idempotent event per final turn status.
- Uses GPT Transcribe for audio when requested by the watch.
- Stores long-lived credentials in macOS Keychain.
- Atomically claims authenticated inbound message IDs on disk before side effects, preventing replay across restarts and concurrent processes.
- Runs as a throttled background launchd agent.

The polling fallback examines only `completed`, `failed`, or `interrupted` turn records. It cannot turn reasoning, tool progress, item completion, or partial assistant text into an alert.

## iPhone boundary

An iPhone can control Codex sessions against the same managed daemon through Codex remote control. Agentic Wear observes those daemon sessions. It does not embed ChatGPT/Codex Live, deep-link into private iOS app state, or create a direct Bluetooth/iOS companion channel in v0.1.
