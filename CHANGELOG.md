# Changelog

Every public build remains an Alpha GitHub Pre-release until the project is explicitly promoted.

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
