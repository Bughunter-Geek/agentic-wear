# Changelog

Every public build remains an Alpha GitHub Pre-release until the project is explicitly promoted.

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
