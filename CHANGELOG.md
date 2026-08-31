# Changelog

Every public build remains an Alpha GitHub Pre-release until the project is explicitly promoted.

## Unreleased

## 0.6.3-alpha — 2026-08-31

This is a public Alpha prerelease for remote OTA testing. Automated checks pass and an independent-client harness verifies the repaired resume/start handoff; physical Pixel Watch acceptance remains pending.

- Loads watch chat history through Codex's bounded summary view instead of serializing reasoning, command output, file changes, and tool payloads that the watch discards. This prevents large cross-client chats from exceeding the daemon transport limit or surfacing internal cancellations such as `bs1 was cancelled`.
- Retries transient App Server history cancellations and replaces internal task identifiers with actionable recovery text if bounded retries are exhausted.
- Queues messages directly into mobile/Desktop-owned `notLoaded` sessions, wakes an otherwise dormant queue, starts the exact submission, and handles the App Server resume/auto-start race without duplicating the Watch request UUID.
- Keeps the launchd bridge alive when Codex Desktop is closed by falling back to a private background App Server. The private process is recycled after its Watch-controlled turn so Android and iOS can resume the same chat.
- Adds an explicit green `Ready` state only after the bridge has successfully read the chat and probed its cross-client queue; merely listed chats remain gray `Available`.
- Replaces local image paths and attachment metadata with a compact singular/plural image notice directing the user to Android or iOS.
- Ignores delayed `turn.error` payloads unless they match the exact currently pending Watch request, preventing an old `bs1 was cancelled` from replacing a later successful state.
- Distinguishes a pre-queue send failure from a chat-history failure so the watch never claims a message was sent when App Server did not accept it.

### Test status

- Bridge unit tests, TypeScript checks, Oxlint, Wear unit tests, release lint, R8, and signed release assembly pass.
- With the Codex Desktop daemon absent, a disposable foreign session accepted and completed exactly one Watch submission. An independent App Server then resumed the same chat and started a new turn after the Watch refreshed its history. Physical OTA acceptance remains unverified for this Alpha.

## 0.6.2-alpha — 2026-08-30

This is a public Alpha prerelease for remote OTA testing. The fix is locally validated; physical Pixel Watch and cross-device acceptance remain pending.

- Retries transient Codex rollout synchronization before reporting that a listed chat cannot be loaded, covering the short handoff window between mobile, Desktop, and the shared bridge.
- Extends the watch's chat-response window and correlates snapshots and errors with the selected thread and latest request, preventing a delayed error from an older refresh from replacing a usable chat.
- Keeps the selected session and draft intact when synchronization is still unavailable, and offers a refresh action instead of incorrectly telling the user that the chat was permanently removed.
- Opens changed error details at the beginning of the message so the complete recovery guidance remains readable on the round display.

### Test status

- All 77 bridge tests, TypeScript checks, Oxlint, Wear unit tests, release lint, R8, and release assembly pass.
- The affected shared-daemon session was independently confirmed as listed and readable after the transient failure. Physical OTA acceptance remains unverified for this Alpha.

## 0.6.1-alpha — 2026-08-30

This is a public Alpha prerelease for immediate OTA testing. Cross-device behavior is validated against independent clients on the shared Codex daemon; physical iOS, Android, and Pixel Watch acceptance remains pending.

- Replaces thread takeover with Codex App Server 0.150's supported cross-client queue. Existing chats are never resumed, started, or steered by Agentic Wear; each watch prompt uses its request UUID as the queue idempotency key.
- Connects the bridge to the shared remote-control daemon instead of a private App Server, so Desktop, iOS, Android, and Wear observe the same thread ownership and queued turns.
- Releases newly created thread subscriptions before the first prompt is queued and retries bounded release failures, preventing Agentic Wear from leaving a writer that makes mobile chat history unloadable.
- Keeps session polling observation-only and associates release with the exact bridge-controlled turn, preventing an older completion from releasing a newer turn or creating duplicate sends.
- Replaces the clipped error sheet with an animated, round-safe full-screen detail view whose scroll hint disappears after the complete message is visible.

### Test status

- All 75 bridge tests, TypeScript checks, Oxlint, Wear unit tests, release lint, R8, and release assembly pass.
- A live three-client shared-daemon test completed A → B → C continuations in one thread with distinct turns and no retained writer. Physical cross-device acceptance remains unverified for this Alpha.

## 0.6-alpha — 2026-08-29

This is an explicitly unverified public Alpha prerelease. The physical minimized-watch acceptance test is still pending.

- Adds a diagnostic-only Codex App Server realtime-voice capability check. The encrypted recording → local transcription → text-turn path remains unchanged unless `gpt-live-1` is actually present in the App Server model catalog and a reviewed watch transport is added.
- Corrects foreign-session recovery: an active writer is reported as an unsent, unqueued draft instead of suggesting that restarting Codex will safely queue it. The watch can refresh the session list or explicitly preserve its draft for a new session; it never sends that draft to another thread silently.
- Makes watch errors tap-to-open and scrollable, with complete TalkBack descriptions. Long permission requests retain their full accessible text rather than relying on clipped cards or ellipses. Removes the accidental 260-character bridge/watch error cap while whitespace-normalizing and redacting credential-shaped values before encryption.

### Test status

- Bridge and Wear unit/lint/build checks pass, and the 454 px Wear OS emulator verifies the full error dialog, scroll affordance, and draft-preserving recovery flow. Physical minimized-watch and notification delivery remain unverified for this prerelease.

## 0.4.7-alpha — 2026-08-29

### Added

- Adds watch-visible user messages and structured Markdown rendering to the live session, while keeping reasoning and tool payloads out of the watch cache.
- Adds accessible like/dislike controls for completed Codex responses. Feedback uses Codex's supported feedback endpoint, tags the exact turn and response, and includes no local logs.
- Adds a persistent permission mode beside model controls, shows live permission requests as distinct chat cards, and handles current App Server permission-profile requests with exact, one-turn grants for watch-owned sessions.

### Fixed

- Rejoins an idle iOS/Android-owned task through Codex's shared daemon, applies the watch-selected model and reasoning effort, and starts the turn on that same live thread so connected clients receive updates. A failed settings update prevents the prompt from being sent with stale settings.
- Replaces the generated-but-unavailable `thread/queue/add` path with runtime-supported resume/start behavior; busy cross-client tasks now return an explicit retry message instead of interrupting the active turn.
- Makes model selection atomic by resetting effort to the newly selected model's advertised default every time.
- Stops flattening Markdown and paragraph spacing into one malformed line.

### Refined

- Replaces the model-control glyph with a native Codex-style gauge, adds a smooth 200 ms scale/fade transition, and avoids full-state reloads when changing model, effort, or permission mode.
- Reworks live chat into round-safe user and Codex message treatments with bounded, role-aware history. Intermediate `UPDATE` cards smoothly auto-collapse by default while final answers remain fully rendered; Settings can disable that behavior.

### Test status

- This remains an Alpha candidate and is not 0.5. Cross-client model visibility and the minimized-watch notification path still require the user's physical Pixel Watch/iOS/Android acceptance test before any milestone promotion.

## 0.4.6-alpha — 2026-08-29

### Refined

- Rebuilds the model and reasoning selector around the round Wear OS canvas with a calmer edge-to-edge overlay, clearer hierarchy, and a reference-led segmented effort rail.
- Replaces improvised glyphs with native Material icons, improves touch targets and haptic feedback, and keeps the selected model centered with round-safe neighboring previews.
- Hides obscured transcript controls from accessibility while the selector is open and exposes labeled range and selection semantics.

## 0.4.5-alpha — 2026-08-29

### Added

- Adds a compact reasoning-effort control to transcript review, with a floating segmented slider that supports direct left/right dragging.
- Adds a horizontally scrollable model picker populated from the paired Codex bridge's live model catalog.
- Persists the selected model and effort on the watch and applies them to the next compatible Codex turn.

### Notes

- Model and effort overrides apply to new or idle watch-owned turns. Prompts queued into sessions owned by another Codex client continue to use that client's active model settings.

## 0.4.4-alpha — 2026-08-28

### OTA path test

- Increments the Alpha build to versionCode 22 so the watch can exercise update discovery, download, signature verification, and the system installer through the public `ota-alpha` channel.
- Contains no claimed fix for minimized completion notifications; its purpose is to verify the OTA path independently before changing notification behavior.
- After installing, open Agentic Wear once so the current pairing can refresh its background-wake registration.

## 0.4.3-alpha — 2026-08-28

### Fixed

- Restores completion and error alerts while Agentic Wear is minimized by enabling Firebase Cloud Messaging in the release APK.
- Registers the watch's Firebase installation with its existing private bridge pairing, so background wake-ups keep working without exposing session content to Firebase.
- Uses an expedited inbox sync after each wake signal, preserving the same encrypted relay and single-notification processing used while the app is open.

### Privacy and cost

- Firebase receives only an `inbox.ready` wake signal and the private pairing identifier; notification text and Codex session content remain end-to-end encrypted in the relay inbox.
- Agentic Wear uses its own dedicated Firebase project on the no-cost Spark plan; it is not connected to Nudgely and does not introduce per-transcription charges.
- Open Agentic Wear once after installing this update so the watch can register background alerts for the existing pairing.

## 0.4.2-alpha — 2026-08-28

### Fixed

- Sends prompts to sessions already open in Codex through the supported cross-client queue, eliminating the raw “already has an active writer” failure.
- Automatically uses the current Codex desktop runtime when available, so Agentic Wear receives the queue and session APIs shipped with the installed app.
- Detects completions by polling the newest turns directly every five seconds, even when another Codex client reports the session as unloaded or leaves its advisory update time stale.
- Baselines terminal history when the bridge starts, preventing old completed or interrupted turns from vibrating the watch after a restart.
- Keeps one terminal event ID per turn, preserving single-notification delivery while the same completion remains visible across polls.

### Notes

- The cross-client queue was validated with two independent Codex app-server processes: the owning process automatically started the prompt submitted by the second process.
- Error delivery to the physical watch was confirmed separately, narrowing the remaining alert defect to completion observation.
- This watch update requires the 0.4.2 bridge.

## 0.4.1-alpha — 2026-08-28

### Fixed

- Restored completion alerts for Codex sessions owned by another active client, including the Codex desktop and mobile interfaces.
- Polls active session windows every five seconds and scans the eight newest turns, so a newer prompt or interrupted turn cannot hide the full response that just completed.
- Keeps terminal-event deduplication, preventing repeated notifications while the bridge observes the same completed turn.
- Handles Codex's second-resolution completion timestamps without dropping responses that finish in the same timestamp second as the preceding activity update.

### Notes

- The push and encrypted relay path was verified independently: FCM woke the remote Pixel Watch, which fetched and acknowledged the diagnostic inbox event.
- This watch update requires the 0.4.1 bridge for the completion-observation fix.

## 0.4.0-alpha — 2026-08-28

### Added

- Crown-scrollable live sessions with the latest five assistant paragraphs and streamed new output.
- Acknowledged prompt delivery to new and existing Codex sessions.
- Active-turn steering when the Codex daemon explicitly permits direct input.
- Semantic voice revisions that replace conflicting older requirements and preserve unrelated instructions.
- Promoted ongoing voice-session support on Wear OS 7 while recording or waiting for transcription.

### Fixed

- Replaced the daemon-advertised but runtime-unsupported `thread/items/list` call with supported, one-turn-at-a-time history retrieval.
- Preserved genuine completion/error vibrations while the live-session screen polls its inbox.
- Kept the unsent transcript until the matching `turn.accepted` acknowledgement arrives.
- Restored the original draft when a smart revision fails before or during bridge processing.
- Prevented stale cached chat content from being mistaken for a fresh bridge response.
- Expanded round-screen errors and made session/transcript/chat screens reachable with the Pixel Watch crown.

### Notes

- Local Whisper transcription remains free of per-minute API charges. Smart revision uses one low-effort ephemeral Codex turn on the owner's private bridge and therefore uses that owner's Codex allowance.
- Codex 0.147 exposes steering but no supported prompt-queue operation; queue mode remains future work.
- This watch update requires the 0.4.0 bridge.
