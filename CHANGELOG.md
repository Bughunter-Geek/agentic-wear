# Changelog

Every public build remains an Alpha GitHub Pre-release until the project is explicitly promoted.

## 0.6.18-alpha — 2026-09-04

- Moves relay ECDH off the watch's failing KeyMint EC operation while preserving P-256, the existing wire protocol, and end-to-end encryption.
- Encrypts the software ECDH private key at rest with a dedicated Android Keystore AES-GCM key and binds the stored public key as authenticated data.
- Advances the local pairing protocol so upgraded watches require one intentional re-pair instead of silently mixing the bridge's old registered key with the replacement key.

### Test status

- Wear unit tests, debug lint, and debug assembly cover the replacement software ECDH path. Release signing, APK metadata, checksum, and OTA-manifest checks are completed during release preparation. Physical-watch acceptance remains pending until the published Alpha reaches the remote watch and is re-paired once.

## 0.6.17-alpha — 2026-09-04

- Replaces sub-second Keystore retries with Android's reported recovery policy: backend-busy hints are honored directly, evacuated crypto operations are recreated immediately, and KeyMint exponential backoff starts at the documented five-second minimum.
- Reads the underlying Android Keystore error instead of treating every provider failure as temporary hardware contention.
- Surfaces a sanitized numeric security code and the correct recovery when Android reports a locked watch, connectivity/reboot requirement, or permanently unusable pairing key.

### Test status

- Wear unit tests, debug lint, and debug assembly pass. Minified release signing, APK metadata, checksum, and OTA-manifest checks are completed during release preparation. Physical-watch acceptance remains pending until the published Alpha reaches the remote watch.

## 0.6.16-alpha — 2026-09-04

- Serializes Android Keystore access across the foreground UI, voice service, and inbox worker so concurrent startup/sync work cannot contend for the watch's security hardware.
- Shares decrypted pairing data and the derived relay key process-wide, avoiding redundant hardware-backed decryptions and ECDH operations after an app update or process restart.
- Retries only transient Keystore/provider failures with bounded backoff and a freshly loaded Keystore facade on every attempt; permanent key invalidation and credential-integrity failures still surface immediately.
- Replaces the misleading "Tap Retry" security-hardware text with instructions that match the actual Close and Send controls, and removes unrelated session-switch recovery actions from this failure.

### Test status

- Wear unit tests, debug lint, and debug assembly pass. Minified release signing, APK metadata, checksum, and OTA-manifest checks are completed during release preparation. Physical-watch acceptance remains pending until the published Alpha reaches the remote watch.

## 0.6.13-alpha — 2026-09-03

- Expands `FullTextDetailDialog` reading space on round and compact-square viewports: makes the entire dialog scrollable with rotary crown support, expands text width from 123 dp to 187 dp on round displays (20 dp padding), and moves the Close button to the end of content so full error messages display cleanly on a single screen without scrolling.
- Replaces the intrusive static scroll affordance with a subtle floating indicator that only appears when significant text remains below the fold, taking zero vertical layout space away from text.
- Expands `ErrorRecoveryPolicy` to recognize session synchronization errors, presenting both "Refresh sessions" and "Start new" options so users can easily recover their drafts or start a fresh session.
- Proactively syncs fresh session lists from the bridge to the watch whenever a session synchronization error occurs, clearing stale or deleted threads automatically.

### Test status

- All 115 bridge tests, 18 relay tests, Wear unit tests, and lint pass with 0 errors. Release signing with versionCode 39, checksum verification, and visual interaction checks pass across 454×454 round and 360×360 compact-square viewports.

## 0.6.12-alpha — 2026-09-03

- Adds the Recent-Sessions Tile (`RecentSessionsTileService`) backed by the watch's encrypted local cache, providing instant glanceable access to active and recent Codex sessions with tap-to-resume navigation.
- Fixes chat conversation scroll positioning on round and compact-square viewports so entering a live session displays the newest conversation content with the live thinking indicator positioned beneath it, without pushing earlier messages off-screen.
- Refines `AgentThinkingIndicator` for compact square screens with responsive padding and single-line layout to prevent awkward wrapping while preserving polite accessibility announcements.
- Automatically requests Tile updates from `AgenticWearRepository` whenever session snapshots arrive or connections change.

### Test status

- All 115 bridge tests, 18 relay tests, Wear unit tests, and lint pass with 0 errors. R8 shrinking, release signing with versionCode 38, checksum verification, and emulator interaction checks pass across 454×454 round and 360×360 compact-square viewports.

## 0.6.9-alpha — 2026-08-31

- Rebuilds the Home session selector as a full-width Material 3 stadium button with a proper session-state hierarchy and directional affordance.
- Replaces the old rectangular bottom controls with an animated two- or three-action circular dock for Sessions, Latest result, and Settings while preserving 48 dp touch targets.
- Keeps OTA availability out of the navigation dock and surfaces available, downloading, and ready states as a dedicated compact action beneath the voice orb.
- Adapts Home independently for round and compact square watches so voice state, update status, and action controls remain readable without bezel clipping or collisions.
- Preserves the voice orb as the primary action and prevents its decorative activity halo from consuming layout space or hiding live status text.

### Test status

- All 113 bridge tests, 18 relay tests, Wear unit tests, debug lint/assembly, round/square interaction checks, and Material 3 button-group motion checks pass. Motion was verified at 0×, 0.5×, 1×, and 10× animation scales with no stuck or clipped state. Gemini 3.7 Flash at High reasoning independently passed the final Antigravity visual gate with no release blockers across round and square Home states.

## 0.6.8-alpha — 2026-08-31

- Sends every Watch prompt as a canonical App Server user message in the original chat, including Android/iOS/Desktop-controlled active turns; no current send uses the retired native-tool relay and no route creates or forks a chat.
- Applies the selected model and reasoning directly as sticky thread settings before queueing or steering, removing the previous cross-client propagation wait.
- Inserts accepted Watch prompts into the live chat immediately and replaces them with canonical history once synchronized, so the prompt cannot disappear while its response remains visible.
- Refreshes the actively watched chat every two seconds and forces a fresh snapshot at terminal delivery, closing the gap between the response alert and the rendered answer.
- Opens each chat at its newest message, follows appended output only while the user remains near the bottom, and shows a jump-to-latest control after deliberate upward scrolling.
- Rebuilds the round-display Queue and Voice reply actions as bezel-following Wear OS EdgeButtons while retaining rectangular controls on square watches. The send chooser keeps the underlying review blurred for readable one-shot Queue/Steer selection.

### Test status

- Bridge, relay, Wear unit/lint, minified release, signing, APK metadata, checksum, and round-emulator interaction checks pass. Gemini 3.7 Flash at High reasoning independently passed the final Antigravity visual gate with no release blockers for round safe zones, EdgeButtons, or live-chat bottom padding.

## 0.6.7-alpha — 2026-08-31

- Makes a normal Watch Send respect Codex Desktop's current Queue or Steer follow-up preference.
- Adds a long-press Send chooser with one-shot `Steer now` and `Queue next` actions.
- Routes active steering through the exact Watch-controlled turn or Codex Desktop's signed same-chat follow-up interface without creating another chat.
- Keeps queued model/reasoning changes durably pending until the active turn finishes when applying them immediately would alter the wrong turn.
- Applies the Watch model and reasoning selection as the chat's sticky configuration for the next new turn while steering the current turn with the model it already started with.
- Keeps the direct queue/start path for idle chats where there is no active turn to steer.
- Seals a pre-dispatch message baseline with every cross-client handoff and reconciles the original task before retrying after an interrupted acknowledgement, preventing lost or duplicated Watch prompts.
- Removes delegated-message metadata from Watch chat rendering so the submitted prompt appears normally in the session UI.

### Test status

- All 112 bridge tests, 18 relay tests, and 55 Wear unit tests pass with TypeScript, test-type, Oxlint, debug lint/assembly, release R8, signing, APK metadata, checksum, and OTA-manifest checks. A 454 × 454 round Wear OS 7 emulator verified the blurred Queue/Steer chooser at normal and 10× animation speed without clipping; physical-watch acceptance remains pending.

## 0.6.6-alpha — 2026-08-31

This public Alpha prerelease replaces the single sticky OTA request with a bounded, restartable check and adds update availability to Home.

- Races the GitHub raw manifest and Contents API routes, accepting the first valid newer release.
- Ends checks after a 15-second overall deadline and lets the checking card restart an in-flight request without force-stopping the app.
- Persists the last verified newer release so availability survives process restarts and temporary loss of connectivity.
- Refreshes silently on launch and after returning to the foreground once the refresh interval expires.
- Shows a mint update status and dedicated Update action on Home without displacing the voice control or navigation actions.

### Test status

- All 54 Wear unit tests, debug lint/assembly, release R8/signing, APK metadata, checksum, and OTA-manifest checks pass. Live emulator validation discovered the real 0.6.5 manifest from an older local build, restored it after an offline force-stop, and confirmed the round Home layout and control semantics without crash logs. Physical Pixel Watch acceptance remains pending.

## 0.6.5-alpha — 2026-08-31

This is a public Alpha prerelease for remote OTA testing. Automated checks pass; physical Pixel Watch acceptance of the owner-held model-routing flow remains pending.

- Applies the Watch model and reasoning selection before adding or starting a prompt whenever the bridge can acquire the original session.
- Keeps same-chat sends immediate when the owning client's persisted model and effort already match the Watch selection.
- When an owner-held session has different settings, encrypts the exact prompt locally, acknowledges it as waiting instead of showing a false send error, and retries the original chat with the same request ID after ownership releases. No chat is forked.
- Clears transcript review after every durable acceptance and shows waiting/started state as nonfatal status inside the live chat.
- Prevents internal App Server cancellation task IDs from becoming foreign-session Watch alerts; controlled cancellations use generic interrupted wording.
- Removes observation-only queue/history probes as evidence for a green Ready state.

### Test status

- All 93 bridge tests, 18 relay tests, and 52 Wear unit tests pass, along with TypeScript/Oxlint, debug lint, debug assembly, release R8/signing, APK metadata, checksum, and OTA-manifest verification. Physical Pixel Watch acceptance remains pending.

## 0.6.4-alpha — 2026-08-31

This is a public Alpha prerelease for remote OTA testing. The retained-writer failure is reproduced and covered by regression tests; physical Pixel Watch acceptance remains pending.

- Keeps a Watch prompt in Codex's accepted cross-client queue when an idle task is still owned by Desktop or mobile and the private bridge is therefore forbidden to resume it.
- Stops deleting that already-accepted prompt and falsely reporting it as unsent. The owning Codex client can process the queued turn without Agentic Wear stealing its writer.
- Preserves the 0.6.3 direct wake/start path when no other client owns the idle task, and continues queueing behind genuinely active foreign turns.

### Test status

- The bridge regression suite reproduces the exact `already has an active writer` response after queue acceptance and verifies that the bridge acknowledges the Watch request without calling queue deletion or taking ownership.
- All 87 bridge tests, 18 relay tests, 53 Wear tests, TypeScript/Oxlint, release lint, R8, and signed code-30 assembly pass. The APK package/version, signing certificate, size, and SHA-256 manifest fields were verified; physical OTA acceptance remains unverified for this Alpha.

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
- Agentic Wear uses its own dedicated Firebase project on the no-cost Spark plan; it is not connected to any unrelated product and does not introduce per-transcription charges.
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
