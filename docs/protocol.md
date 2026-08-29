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
| `transcription.create` | Send one bounded AAC/M4A recording of up to four minutes, plus an optional bounded previous draft for an explicit semantic revision. |
| `turn.submit` | Send up to 12,000 characters of reviewed text to a new or selected session, with an optional bridge-advertised model and reasoning effort. |
| `approval.respond` | Accept or decline a controllable watch-owned approval. |
| `feedback.submit` | Like or dislike one exact Codex response; includes thread, turn, and item IDs but no log files. |
| `chat.watch` / `.unwatch` | Start or stop a 90-second renewable live-view subscription for one selected session. |

## Bridge to watch

| Kind | Purpose |
|---|---|
| `sessions.snapshot` | Recent session title, time, status, ownership, and the current bridge model catalog. |
| `transcription.ready` / `.error` | Return transcript or safe failure. |
| `turn.accepted` / `.error` | Confirm prompt handoff or failure. |
| `chat.snapshot` / `.error` | Return a bounded role-aware message history with Markdown preserved, or an actionable live-view failure. |
| `approval.request` | Alert with optional watch-owned controls. |
| `approval.accepted` / `.error` | Confirm approval response or failure. |
| `feedback.accepted` / `.error` | Confirm that Codex accepted the response feedback, or return a safe failure. |
| `terminal.completed` | Top-level user turn completed successfully; requires `turnScope: "topLevel"`. |
| `terminal.failed` / `.interrupted` | Final unsuccessful top-level turn states; requires the same scope. |

Terminal failures and request-level `.error` payloads produce red alerts. Each
alert is deduplicated by its authenticated envelope or terminal event ID.

Message IDs and terminal event IDs are idempotency keys. The watch acknowledges inbox envelopes only after successful decryption and handling.

Chat snapshots contain at most twelve recent user and assistant messages with their roles, turn IDs, message IDs, phase, and original Markdown line breaks. Active approval requests may appear as a typed `permission` message with a bounded reason, approval ID, control eligibility, and resolved state. Reasoning, tool output, command/file output, and hidden instructions never enter the watch chat cache. The bridge retrieves full history one turn at a time and updates its bounded assistant-message cache from deltas while the renewable watch subscription is active. A temporary five-paragraph assistant-only field remains in the payload for pre-0.4.7 watch compatibility.

The watch labels commentary-phase assistant messages as `UPDATE`. They are collapsed by default, expand with an animated tap transition, and can be left expanded globally through the persisted Settings preference. Final answers are always fully rendered. Permission messages use their own `PERMISSION` label and never inherit update styling.

Feedback is an explicit user action. The bridge maps thumbs-up/down to Codex App Server's `good_result`/`bad_result` classifications, tags the exact turn and item, and sets `includeLogs: false`.

`turn.accepted` is a transaction acknowledgement: the watch retains the editable draft until the matching request ID is accepted. An active watch-owned session uses `turn/steer` only when Codex reports direct-input support and the bridge knows the exact active turn ID. For an idle session owned by another Codex client, the bridge rejoins the shared daemon thread, waits for `thread/settings/update` to apply the selected model and effort, then calls `turn/start` on that same thread. A settings failure prevents sending. A busy cross-client session returns a retryable error rather than being interrupted. The generated 0.147 schema advertises `thread/queue/add`, but the shipping 0.147 runtime rejects that method, so Agentic Wear does not depend on it.

Command, file-change, and permission-profile approvals remain controllable only for watch-owned sessions. Permission acceptance returns the exact requested profile with `scope: "turn"`; decline returns an empty one-turn grant. Existing sessions owned by another client stay alert-only.

The watch caps compressed recording files below 1.3 MB. The encrypted transport independently caps audio, ciphertext, WebSocket messages, and HTTP request bodies at each hop. Watch-to-bridge audio remains live-only and is never stored in the relay inbox.

Only the App Server's `turn/completed` notification for a top-level user thread
may produce a terminal alert. Item completion, raw response completion,
reasoning updates, agent-message deltas, and nested-agent turn completion are
not terminal signals. The watch independently rejects terminal alerts without
the explicit top-level scope marker.
