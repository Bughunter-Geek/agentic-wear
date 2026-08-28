# Pairing protocol v2 and encrypted envelopes v1

## Endpoint-authenticated pairing

The bridge generates an eight-character code from an unambiguous 32-character alphabet. The code stays on the bridge display and is entered directly on the watch; it is never sent to the relay.

Both endpoints normalize the code and derive a 256-bit authenticator with PBKDF2-HMAC-SHA-256 using salt `agentic-wear-pair-auth-v2` and 120,000 iterations. The opaque pairing ID is:

```text
base64url(SHA256("agentic-wear-pair-id-v2\0" || authenticator))
```

The handshake is:

1. The bootstrap-authenticated bridge registers the pairing ID and its P-256 public key. The fixed admission object records the ID for ten minutes.
2. The watch derives the same ID from the entered code, submits its public key, and receives a role-specific relay credential plus the bridge public key.
3. The watch sends an HMAC proof over the role, pairing ID, bridge public key, and watch public key.
4. The bridge verifies that proof, then sends its own role-separated proof over the same transcript.
5. The watch verifies the bridge proof. Only then does it persist the bridge key and credential. The bridge likewise persists the watch key only after verifying the watch proof.

Proof input is UTF-8 text with newline separators:

```text
agentic-wear-pair-v2
pairId
role
bridgePublicKey
watchPublicKey
```

The HMAC key is the derived authenticator and the hash is SHA-256. A proof or public key may not change after it is first recorded. Pairing protocol v1 is rejected rather than silently migrated.

## Encrypted envelopes

Every relay envelope contains `version`, `messageId`, `sender`, `recipient`, `sentAt`, a 12-byte base64 nonce, and base64 ciphertext. AES-GCM authenticates `version|messageId|sender|recipient|sentAt` as additional data.

The shared key is derived from P-256 ECDH with HKDF-SHA-256:

- Salt: `SHA256("agentic-wear-v1:" + pairId)`
- Info: `relay-e2ee`
- Output: 256-bit AES key

The bridge rejects envelopes older than 24 hours or more than five minutes in the future. After successful AEAD decryption and payload-schema validation, it atomically creates a durable message-ID claim before executing any Codex action. An existing claim is a replay and is ignored. Claims remain after a downstream failure so a partially completed action cannot run twice.

## Watch to bridge

| Kind | Purpose |
|---|---|
| `session.sync` | Request the recent session snapshot. |
| `transcription.create` | Send one bounded AAC/M4A recording of up to four minutes for transcription. |
| `turn.submit` | Send up to 12,000 characters of reviewed text to a new or selected session. |
| `approval.respond` | Accept or decline a controllable watch-owned approval. |

## Bridge to watch

| Kind | Purpose |
|---|---|
| `sessions.snapshot` | Recent session title, time, status, and ownership. |
| `transcription.ready` / `.error` | Return transcript or safe failure. |
| `turn.accepted` / `.error` | Confirm prompt handoff or failure. |
| `approval.request` | Alert with optional watch-owned controls. |
| `approval.accepted` / `.error` | Confirm approval response or failure. |
| `terminal.completed` | Top-level user turn completed successfully; requires `turnScope: "topLevel"`. |
| `terminal.failed` / `.interrupted` | Final unsuccessful top-level turn states; requires the same scope. |

Terminal failures and request-level `.error` payloads produce red alerts. Each
alert is deduplicated by its authenticated envelope or terminal event ID.

Message IDs and terminal event IDs are idempotency keys. The watch acknowledges inbox envelopes only after successful decryption and handling.

The watch caps compressed recording files below 1.3 MB. The encrypted transport independently caps audio, ciphertext, WebSocket messages, and HTTP request bodies at each hop. Watch-to-bridge audio remains live-only and is never stored in the relay inbox.

Only the App Server's `turn/completed` notification for a top-level user thread
may produce a terminal alert. Item completion, raw response completion,
reasoning updates, agent-message deltas, and nested-agent turn completion are
not terminal signals. The watch independently rejects terminal alerts without
the explicit top-level scope marker.
