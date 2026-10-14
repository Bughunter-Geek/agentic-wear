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

## Emulator visual QA (when explicitly requested)

The user owns visual review, sound, animation quality, real connectivity, and physical-device acceptance. Run agent-side emulator QA only when explicitly requested; the scenarios below are a reference for selecting the affected states, not a mandatory checklist for every build. Reuse passing automated checks while the relevant code is unchanged, and keep the release safeguards below.

The debug activity accepts synthetic demo states through `io.github.sirbughunter.agenticwear.DEMO_STATE`:

```bash
adb shell am start -n io.github.sirbughunter.agenticwear.debug/io.github.sirbughunter.agenticwear.MainActivity \
  --es io.github.sirbughunter.agenticwear.DEMO_STATE sessions
```

Inspect `home`, `home-alert`, `home-error`, `home-update`, `home-update-downloading`, `home-update-ready`, `home-listening`, `home-transcribing`, `pair`, `sessions`, `activity`, `transcript`, `send-mode`, `reply`, `text-reply`, `chat`, `chat-idle`, `chat-roles`, `chat-permission`, `chat-error`, `approval`, `complete`, `error`, and `settings` on a round Wear OS emulator, plus the live call through the debug `ReviewQaActivity` scenarios `live-idle`, `live-connecting`, `live-listening`, `live-speaking`, `live-working`, `live-permission`, `live-muted` and `live-reconnecting-permission`. Check clipping against the round bezel, crown-scroll reachability, 48 dp touch targets, that scrolled content fades out beneath the time, notification icon rendering, one-second alert vibration semantics, and motion at normal and disabled animation scales.

Design expectations (Orb redesign): OLED black, neutral greys and white primary actions; status colours appear only as small signals. Home keeps the chat chip, the cloud orb (tap to talk live), Chats and Activity beside the orb, the label or update/error pill under it, and a Dictate edge button; none of these may overlap. Edge buttons follow the bezel curve. Swipe right goes back everywhere except Review, where swiping is disabled so a draft cannot be discarded by accident; Review offers an explicit Discard draft. The cloud orb's size follows only the user's own observed input level; agent speech never changes its size and instead makes the fog inside move faster and further. Approval waits, muted input, reconnection and reduced motion freeze it; idle drift runs at a reduced frame rate. Dictation uses the waveform screen, never the orb: the bars are recent real microphone levels, tapping the background or × cancels immediately, ✓ or the waveform finishes, and transcribing shows a pulse with live elapsed time. Live chat must show both roles (user bubbles, plain-text answers), preserve headings/emphasis/lists/code, smoothly expand and collapse intermediate updates, expose like/dislike controls for completed responses, distinguish permission cards and their controls, show actionable failures with a Details view, and keep terminal notifications enabled while visible. While a session is active without an unresolved permission or error, show the Thinking row and keep it followed at the latest message; permission waits must never present as thinking. Reply opens Talk / Dictate / Type; Type opens the Wear keyboard and sends through the same reviewed model, effort and queue/steer path as voice. Decision-needed alerts keep Decline and Allow inside the round safe area without scrolling. In a live call the caption never collides with Mute and End. Verify the Settings opt-out leaves update cards expanded.

For requested emulator QA, the reference device is a 454 × 454 round Wear OS 7 / Android 17 (API 37) emulator. If updater UI testing is requested, exercise the complete updater path there: detect a higher version, download and verify it, grant the one-time per-source install permission, confirm in the native package installer, and verify that the installed `versionCode` increased without clearing app data.

The user is the visual reviewer. After the relevant local checks, deliver through the signed public GitHub Alpha and OTA channel authorized in `AGENTS.md`, unless the user requests a different channel for the current task. Give the user one short, targeted test after publication. Gemini availability is not a delivery gate. If an external review is requested, share only synthetic states; physical acceptance remains pending user confirmation.

## Release gate

A public or tester release additionally requires explicit authorization, release signing, a version-code increase, minified release assembly, updater-path verification, and confirmation that no secret or unrelated private-product identifier is tracked. Building locally does not imply deployment or distribution.
