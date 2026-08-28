# Testing and release

## Automated checks

```bash
npm --prefix bridge run check
npm --prefix bridge test
npm --prefix relay run check
npm --prefix relay test
./gradlew :wear:lintDebug :wear:assembleDebug
```

The bridge suite includes cross-endpoint crypto interoperability, shared bridge/watch pairing vectors, persistent and concurrent replay rejection, timestamp bounds, and a negative matrix proving that reasoning/item/raw-response notifications cannot be classified as a finished turn. Relay tests cover mutual endpoint proof state, substitution rejection, pre-allocation admission, source rate limiting, bounded pending state, idempotent ciphertext queues, acknowledgement, refusal to persist offline watch audio, and suppression of duplicate Firebase wakes. Watch tests verify atomic alert claiming, one continuous one-second vibration policy, and silence-gated voice activity mapping.

## Emulator visual QA

The debug activity accepts synthetic demo states through `io.github.sirbughunter.agenticwear.DEMO_STATE`:

```bash
adb shell am start -n io.github.sirbughunter.agenticwear.debug/io.github.sirbughunter.agenticwear.MainActivity \
  --es io.github.sirbughunter.agenticwear.DEMO_STATE sessions
```

Inspect `home`, `home-listening`, `home-speaking`, `pair`, `sessions`, `transcript`, `approval`, `complete`, `error`, and `settings` on a round Wear OS emulator. Check clipping, scroll reachability, touch targets, notification icon rendering, one-second alert vibration semantics, and motion at normal and disabled animation scales. The listening state must remain perfectly still under the voice noise gate; only the speaking state may animate.

The release baseline is a 454 × 454 round Wear OS 7 / Android 17 (API 37) emulator. Exercise the complete updater path there: detect a higher version, download and verify it, grant the one-time per-source install permission, confirm in the native package installer, and verify that the installed `versionCode` increased without clearing app data.

Use only these synthetic states for external visual review. Send the primary, transcript, session, approval, completion, and error screenshots to Gemini through Chrome, iterate on actionable findings, and stop at that review gate if Gemini is unavailable.

## Release gate

A public or tester release additionally requires explicit authorization, release signing, a version-code increase, minified release assembly, updater-path verification, and confirmation that no secret or unrelated private-product identifier is tracked. Building locally does not imply deployment or distribution.
