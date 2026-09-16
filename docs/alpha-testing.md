# Alpha testing guide

This guide is for **Agentic Wear 0.6.25-alpha**, published September 6, 2026 (`versionCode 51`). It helps testers produce reproducible evidence; it does not claim that the checks below have already passed on a physical watch.

[Project overview](../README.md) · [Release and APK](https://github.com/Bughunter-Geek/agentic-wear/releases/tag/v0.6.25-alpha) · [Matching source](https://github.com/Bughunter-Geek/agentic-wear/tree/v0.6.25-alpha)

## Before installing

Use a disposable Codex project with synthetic prompts and session names. You need your own compatible Codex installation and an authenticated private macOS bridge. A watch APK alone is not a hosted service. New self-hosters must configure their own relay and Firebase client as described in the [tagged setup instructions](https://github.com/Bughunter-Geek/agentic-wear/blob/v0.6.25-alpha/README.md).

Record the watch model, Wear OS/Android version, app version and versionCode, Mac/macOS, bridge commit, Codex CLI version, transcription provider, and whether this is a fresh installation or an upgrade. Do not include serial numbers, pairing codes, service-account files, private project paths, or credentials in public reports.

The default branch currently predates this alpha implementation. Use the matching tag for reproducible tests. To avoid changing existing work, clone into a new directory:

```bash
git clone --branch v0.6.25-alpha --depth 1 \
  https://github.com/Bughunter-Geek/agentic-wear.git agentic-wear-alpha-0.6.25
cd agentic-wear-alpha-0.6.25
```

Follow that checkout's setup instructions. **The Mac bridge must also be updated for the 0.6.25 delivery fixes**; installing the watch update alone is insufficient. Rebuilding and reinstalling the bridge service changes which checkout it runs, so inspect its status and do not leave two bridge instances running unintentionally.

## Install or update the watch

For an existing configured, release-signed installation, use **Settings → App updates** and confirm the system installer. For a first installation on a configured deployment, download `agentic-wear.apk` from the explicit [0.6.25 release](https://github.com/Bughunter-Geek/agentic-wear/releases/tag/v0.6.25-alpha), not an assumed “latest stable” link.

On macOS, check the downloaded file before installing:

```bash
shasum -a 256 agentic-wear.apk
```

Expected SHA-256 for that release's published APK:

```text
28db699cc83aa5a083bd972df558bb06a1488f820ff21c9a870b0b0185817a2f
```

Stop if the digest differs. This comparison detects a mismatch with the inspected release asset; it is not an independent security audit or a replacement for signing checks.

With the intended watch already connected through ADB, identify it and install explicitly to that device:

```bash
adb devices
adb -s WATCH_SERIAL install -r agentic-wear.apk
```

Replace `WATCH_SERIAL` locally with the intended device identifier. Do not post it in an issue. For a self-hosted deployment with different Firebase/relay configuration, build the client from the tag using your own configuration instead of assuming the published APK matches it.

**Do not uninstall an existing app to bypass a signing mismatch.** Uninstalling can erase pairing and local app data. A debug build, a self-signed build, and a published release may use different signing identities. Stop on a signature or downgrade error and resolve the intended upgrade path first. Keep release keystores and their passwords backed up outside the repository.

See the [release distribution guide](https://github.com/Bughunter-Geek/agentic-wear/blob/v0.6.25-alpha/docs/distribution.md) for updater verification and system-confirmation boundaries. Disable wireless debugging after the initial install when it is no longer needed.

## Focused acceptance checks

Use harmless prompts such as “Reply with TEST COMPLETE; do not run tools or change files.” Record **pass**, **fail**, or **not tested** for each check rather than implying full coverage.

| Check | Exercise | Expected behavior to verify |
| --- | --- | --- |
| Pairing and session selection | Pair to your private bridge; choose a synthetic session. | Both endpoints authenticate, and the displayed session matches the intended Codex thread. |
| Voice and transcript review | Record, stop, inspect and edit the transcript. | Nothing is sent before confirmation; cancellation returns to a usable state. |
| Text and Send control | Open the keyboard, type, dismiss it, and scroll a long draft. | Send remains reachable on the round display and targets the selected session. |
| Prompt delivery | Send one harmless prompt, including a temporary connection interruption in a disposable session. | Delivery has a clear outcome; recovery does not automatically dispatch a duplicate prompt. |
| Another client's session | Send a follow-up with that session idle, then busy; try differing model/effort settings. | Queue/steer behavior is explicit, and unsupported settings or ownership combinations produce an actionable result instead of silently changing intent. |
| Terminal alerts | Complete a harmless turn with the app foregrounded, then with the wrist down/backgrounded. | Intermediate output does not count as completion; final-state alerts have the right session/time and no duplicate vibration. Record foreground and background results separately. |
| Approval boundaries | Inspect a safe test approval in a watch-created session and an existing desktop-controlled session. | Controls appear only for watch-owned sessions; the other session remains alert-only. Do not approve commands with real side effects for this test. |
| Update and persistence | When a newer same-key release exists, update through the system installer. | User confirmation is required, the version increases, and pairing survives. Mark not tested when no suitable newer build exists; do not force a downgrade. |

For a brief battery or latency observation, state the duration, network, foreground/background state, transcription mode, and comparison conditions. Do not extrapolate a short observation into an all-day battery or reliability claim.

## Report a result

Search [existing issues](https://github.com/Bughunter-Geek/agentic-wear/issues) first. For a reproducible non-sensitive defect, open an issue with this structure:

```text
Title: [Alpha 0.6.25] Brief observable problem

Watch model and OS:
App version / versionCode:
Mac / macOS:
Bridge tag or commit:
Codex CLI version:
Transcription provider:
Fresh install or upgrade:
Network and foreground/background state:

Steps to reproduce:
Expected result:
Actual result:
Frequency (for example, 2 of 5 attempts):
Checks passed / failed / not tested:
Redacted screenshot or short recording, if useful:
```

Use synthetic data and inspect screenshots/logs before sharing them. Do not upload private conversations, session identifiers, tokens, environment files, device identifiers, or signing material. Report security vulnerabilities through the private process in [SECURITY.md](https://github.com/Bughunter-Geek/agentic-wear/blob/v0.6.25-alpha/SECURITY.md), not a public issue.

There is no requirement to star the repository or report a positive result. Concrete setup failures, device observations, and reproducible regressions are useful contributions.
