# Testing and release

## Automated checks

```bash
npm --prefix bridge run check
npm --prefix bridge test
npm --prefix relay run check
npm --prefix relay test
./gradlew :wear:lintDebug :wear:assembleDebug
```

The bridge suite includes cross-endpoint crypto interoperability, encrypted crash-safe pending prompts, maximum four-minute audio-envelope acceptance, bounded semantic-revision input, over-limit rejection, shared bridge/watch pairing vectors, persistent and concurrent replay rejection, timestamp bounds, stale-terminal replay rejection, acknowledged thread resume/start behavior, model-catalog normalization, resume-scoped model/reasoning updates, Codex-default and one-shot queue/steer selection, canonical steering and queueing of Android/iOS/Desktop-controlled turns with matching or changed settings, immediate optimistic user-message visibility, one-time legacy handoff reconciliation, exact request-id reuse after release, readiness proof boundaries, internal cancellation sanitization, role-aware Markdown-preserving chat history, cached delta streaming, exact one-turn permission grants, no-log response feedback, and a negative matrix proving that reasoning/item/raw-response notifications cannot be classified as a finished turn. Relay tests cover mutual endpoint proof state, substitution rejection, pre-allocation admission, source rate limiting, bounded pending state, explicit large-envelope bounds, idempotent ciphertext queues, acknowledgement, refusal to persist offline watch audio, and suppression of duplicate Firebase wakes. Watch tests verify atomic alert claiming, foreground suppression of pre-existing alerts, deduplicated OTA manifest candidates and newer-release selection, a ten-second fast transcription retrieval window, screen-awake release policy, an idle voice state after leaving transcript review, one continuous one-second vibration policy, silence-gated voice activity mapping, model-default normalization, backward-compatible default sends, explicit queue/steer wire overrides, and common Markdown rendering.

## Emulator visual QA

The debug activity accepts synthetic demo states through `io.github.sirbughunter.agenticwear.DEMO_STATE`:

```bash
adb shell am start -n io.github.sirbughunter.agenticwear.debug/io.github.sirbughunter.agenticwear.MainActivity \
  --es io.github.sirbughunter.agenticwear.DEMO_STATE sessions
```

Inspect `home`, `home-alert`, `home-update`, `home-update-downloading`, `home-update-ready`, `home-listening`, `home-speaking`, `home-transcribing`, `pair`, `sessions`, `transcript`, `chat`, `chat-permission`, `chat-error`, `approval`, `complete`, `error`, and `settings` on a round Wear OS emulator. Check clipping, crown-scroll reachability, touch targets, notification icon rendering, one-second alert vibration semantics, and motion at normal and disabled animation scales. The home session button must remain readable with long titles, the two- and three-action button groups must stay inside the circular safe area with at least 48 dp targets, and update availability must use the dedicated compact action without adding a fourth dock button. The listening state must remain perfectly still under the voice noise gate. The speaking state must show a pronounced level-driven open halo and waveform; its inner arc must expand around the capped bars without touching them. Transcribing must use only the fixed open-ring glow and show a live elapsed time. The transcript demo must retain the frozen elapsed time in review. Live chat must show both roles, preserve headings/emphasis/lists/code, smoothly collapse and expand `UPDATE` cards, keep final answers fully rendered, expose like/dislike controls for completed Codex responses, distinguish `PERMISSION` cards and their controls, show actionable multi-line failures, and keep terminal notifications enabled while visible. Verify the Settings opt-out leaves update cards expanded.

The release baseline is a 454 × 454 round Wear OS 7 / Android 17 (API 37) emulator. Exercise the complete updater path there: detect a higher version, download and verify it, grant the one-time per-source install permission, confirm in the native package installer, and verify that the installed `versionCode` increased without clearing app data.

Use only these synthetic states for external visual review. Send the primary, transcript, session, approval, completion, and error screenshots to Gemini through Chrome, iterate on actionable findings, and stop at that review gate if Gemini is unavailable.

## Release gate

A public or tester release additionally requires explicit authorization, release signing, a version-code increase, minified release assembly, updater-path verification, and confirmation that no secret or unrelated private-product identifier is tracked. Building locally does not imply deployment or distribution.
