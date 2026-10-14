# Receiver / Mac companion 0.3.15

This package matches Watch 0.6.36/build118. It contains the compiled bridge, Chrome extension and bundled native helper; extraction does not install or activate anything. Requirements: Node.js22+, macOS, compatible Codex native voice/account access, signed-in Chrome and the deployment owner's existing relay/Firebase/pairing setup. Apple-silicon local Whisper/Phonon/model tools remain separate dependencies; they are not hidden in this ZIP. See self-hosted-setup.md for the source deployment steps.

## Existing paired installation

1. Back up the installed receiver/bridge files privately. Keep `.env.local`, private target configuration, Keychain credentials, Chrome storage, existing extension key/ID and watch signing/pairing. Never include these in public reports or packages.
2. End every active call before replacing files, restarting the bridge or reloading Chrome's extension. This release is not silently activated by download.
3. Update the bridge `dist`, its matching runtime dependencies/workers/scripts, and the receiver code in their existing permanent installation paths. Do not remove the working extension or create a second identity. Preserve private files rather than copying a different user's configuration. All receiver/bridge metadata in this package uses 0.3.15.
4. The bundled `scripts/register-receiver-host.mjs` previews registration when run with no arguments. Run with `--apply` only when intentionally registering this package at its permanent path and calls are idle. It checks the existing host name/extension origin, backs up an existing matching manifest and does not restart/reload or change pairing. It refuses a different existing identity.
5. Reload the existing extension after its files are updated. Keep the existing helper registration or perform the explicit matching registration above. Restart the established bridge service only when idle; for new installations the bridge CLI supports `service install`.
6. Enable **Agentic Wear Cloud Receiver (Relay)**, open your Dot, then choose **Connect this Dot** if no matching selection is already saved. The companion's private target must match the same Dot. Selection does not automatically provision a new target on the Mac. A new tester must complete that configuration with the deployment owner before Dot calls.
7. Open the chosen supported cloud chat in Chrome for ordinary-cloud voice. Use Settings → App updates on the Watch for the signed 0.6.36 APK; the system installer requires the owner's confirmation.

## New developer/tester setup

Use the v0.6.36-alpha source tag or this compiled package as the matching implementation. Provision your own relay/Firebase or obtain an explicitly authorized existing tester setup from its owner; bootstrap credentials are never bundled. Complete bridge/Watch pairing, receiver target configuration and native-host registration before voice. Load the extension directory only for a first installation; updates preserve its identity in place.

Example read-only registration preview from the package root:

```sh
node scripts/register-receiver-host.mjs
```

After choosing the permanent path and ending calls, `node scripts/register-receiver-host.mjs --apply` is the explicit registration action. A mismatched registration requires review rather than automatic replacement. This is a developer Alpha, not a turnkey one-click installer.

Watch approval controls are intentionally unavailable in Alpha1; decide in Codex. Ordinary cloud voice does not automatically persist its full spoken transcript. OpenAI distribution permission remains pending. Read PRIVACY.md and the release's known availability issues before testing.

## Optional Phonon-2 dictation

Phonon is an optional English speech-to-text backend on the Mac, separate from native Dot/local live voice. The ZIP contains its worker, not the Python runtime or model weights. `transcription setup` installs Whisper only. Follow [Phonon setup](phonon-setup.md) for the pinned runtime, model acquisition, private configuration and optional Ollama/Qwen cleanup.
