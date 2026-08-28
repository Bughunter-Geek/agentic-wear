# Architecture

## Wear app

The standalone Wear OS app records tap-to-toggle audio, encrypts bridge requests, displays session/alert state, and fetches an encrypted inbox after a high-priority FCM wake. Its live-session screen stores only the newest five assistant paragraphs, polls the encrypted inbox while visible, and keeps genuine terminal alerts eligible even in the foreground. A foreground session silently consumes alerts that predate the moment the app became visible, while completions that occur afterward remain eligible. Every completion, permission, or failure alert uses one continuous one-second vibration and a visually distinct state.

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
- Maintains a bounded cache for a watched session and streams assistant-message deltas without forwarding reasoning or tool output.
- Sends reviewed prompts only after Codex acknowledges the target thread, and steers an active turn only when the daemon explicitly permits direct input.
- Reconciles an explicitly requested correction through one low-effort ephemeral Codex turn, restoring the prior draft on failure.
- Supports hosted GPT Transcribe only as an explicit deployment-owner opt-in.
- Stores long-lived credentials in macOS Keychain.
- Atomically claims authenticated inbound message IDs on disk before side effects, preventing replay across restarts and concurrent processes.
- Runs as a throttled background launchd agent.

The watch sends an explicitly bounded, up-to-four-minute encrypted AAC recording only to its paired bridge. The local worker decodes it through `ffmpeg` pipes and transcribes the in-memory waveform; it does not create an audio file. While recording, Android's screen-awake flag prevents a wrist movement from cancelling the capture. Agentic Wear releases that flag immediately after recording, or after a bounded 30-second foreground transcript wait, so an abandoned request cannot hold the display awake indefinitely. After a user-initiated recording, the watch keeps a fast foreground inbox-retrieval window open for roughly ten seconds so longer transcripts do not fall through to slower background scheduling. This removes hosted inference latency and per-minute transcription billing while keeping raw audio on the bridge host.

When a user revises an unsent draft, the raw audio is still transcribed locally. The resulting correction and prior text are then sent through that owner's local Codex App Server as an ephemeral semantic-editing turn. The relay sees only ciphertext, the turn is excluded from completion alerts, and the operation consumes the owner's Codex allowance rather than a shared transcription service.

There is no shared transcription backend: every deployment owner runs their own bridge and model. The public relay routes opaque envelopes by pair identity and cannot enroll an unrelated watch into another owner's authenticated pair.

The polling fallback examines only `completed`, `failed`, or `interrupted` turn records whose completion time is newer than its preceding observation. It cannot replay an old interrupted turn after an unrelated thread update or turn reasoning, tool progress, item completion, or partial assistant text into an alert.

## iPhone boundary

An iPhone can control Codex sessions against the same managed daemon through Codex remote control. Agentic Wear observes those daemon sessions. It does not embed ChatGPT/Codex Live, deep-link into private iOS app state, or create a direct Bluetooth/iOS companion channel in Alpha 0.4.
