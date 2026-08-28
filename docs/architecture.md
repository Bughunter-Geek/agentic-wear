# Architecture

## Wear app

The standalone Wear OS app records tap-to-toggle audio, encrypts bridge requests, displays session/alert state, and fetches an encrypted inbox after a high-priority FCM wake. It posts notifications even while its activity is foregrounded. Every completion, permission, or failure alert uses one continuous one-second vibration and a visually distinct state.

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
- Uses a persistent local MLX Whisper worker for audio by default, keeping the multilingual model warm between prompts.
- Supports hosted GPT Transcribe only as an explicit deployment-owner opt-in.
- Stores long-lived credentials in macOS Keychain.
- Atomically claims authenticated inbound message IDs on disk before side effects, preventing replay across restarts and concurrent processes.
- Runs as a throttled background launchd agent.

The watch sends a bounded encrypted AAC recording only to its paired bridge. The local worker decodes it through `ffmpeg` pipes and transcribes the in-memory waveform; it does not create an audio file. This removes hosted inference latency and per-minute transcription billing while keeping raw audio on the bridge host.

There is no shared transcription backend: every deployment owner runs their own bridge and model. The public relay routes opaque envelopes by pair identity and cannot enroll an unrelated watch into another owner's authenticated pair.

The polling fallback examines only `completed`, `failed`, or `interrupted` turn records. It cannot turn reasoning, tool progress, item completion, or partial assistant text into an alert.

## iPhone boundary

An iPhone can control Codex sessions against the same managed daemon through Codex remote control. Agentic Wear observes those daemon sessions. It does not embed ChatGPT/Codex Live, deep-link into private iOS app state, or create a direct Bluetooth/iOS companion channel in Alpha 0.2.
