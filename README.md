# Agentic Wear

**Speak to Codex, follow a session, and receive completion or permission alerts from your Wear OS watch.**

Agentic Wear is an unofficial, Apache-2.0-licensed companion that connects a watch to your own macOS Codex bridge. It is not affiliated with or endorsed by OpenAI; “Codex” describes compatibility with the Codex App Server.

[Download Alpha 0.6.25](https://github.com/Bughunter-Geek/agentic-wear/releases/tag/v0.6.25-alpha) · [Matching source](https://github.com/Bughunter-Geek/agentic-wear/tree/v0.6.25-alpha) · [Alpha testing guide](docs/alpha-testing.md)

<!-- Add a real-watch demo here when available. Identify the watch, app release,
bridge revision, and Codex version. Do not imply hardware validation from an emulator. -->

## Alpha 1 development preview

**Alpha 1 is the proposed name for the next preview. Core features mostly work in the tested development setup, but design and stability are unfinished, some features are missing, and security testing and hardening need more time.** It is intended for willing early testers who understand these limitations.

As checked on October 14, 2026, the newest published alpha is still **0.6.25**. Newer live voice work is in private development builds; Alpha 1 is not yet a downloadable release. Read [what to expect from Alpha 1](docs/alpha-preview-status.md) before trying the published alpha or comparing it with development demos.

## Current status

**Early alpha — not a production-stability claim.** The latest published alpha checked on September 16, 2026 is **0.6.25**, released September 6, 2026, with `versionCode 51`.

The default branch currently predates the published alpha implementation. **Use the `v0.6.25-alpha` tag for the features and setup described below**, not an unpinned checkout of `main`. Release-specific documentation links are pinned to that tag so readers can inspect the matching implementation.

The [0.6.25 release notes](https://github.com/Bughunter-Geek/agentic-wear/releases/tag/v0.6.25-alpha) report fixes for the disappearing Send button, interrupted-delivery retries, and replies to sessions controlled by another client. They report **21 added regression tests passing** and a live-relay prompt/acknowledgment/reply check on an emulator. **Physical-watch acceptance for this release remains pending in those notes.** These are reported release results, not a new test run performed by this documentation update.

## What the published alpha includes

- **Voice and text prompts:** tap to record, review and edit the transcript before sending, or reply through the Wear keyboard. Local multilingual Whisper on your private Apple-silicon Mac is the default transcription route; hosted transcription and device speech are optional alternatives.
- **Live Codex sessions:** choose a recent session, read role-aware streamed output and Markdown, and send follow-up prompts. Queueing and explicit steering respect the session's state and supported controls.
- **Useful terminal alerts:** completion, failure, interruption, and permission states include the session and time. Intermediate reasoning, tool progress, and streamed text are not treated as a finished turn.
- **Bounded approval controls:** existing desktop/iPhone-controlled sessions are alert-only for approvals. Accept/decline controls are limited to sessions created by the paired watch bridge.
- **Private bridge and relay transport:** endpoint-authenticated pairing, encrypted watch–bridge payloads, content-free Firebase wake messages, and a reconnecting macOS background service.
- **Signed alpha updates:** a GitHub-based updater checks the APK's checksum, package, version, and signing identity before handing installation to Wear OS. Updates require the owner's confirmation.

See the [release README](https://github.com/Bughunter-Geek/agentic-wear/blob/v0.6.25-alpha/README.md) for the fuller feature and setup reference.

## Getting started

**This is not a standalone watch chatbot or a turnkey hosted service.** You need an authenticated bridge on your own Mac, a compatible Codex installation, and a configured relay. Self-hosting requires your own Cloudflare and Firebase configuration. Installing the APK alone does not provide those services or access to a maintainer's Mac.

### Already paired and configured

Open **Settings → App updates**, or download `agentic-wear.apk` from the [0.6.25 release](https://github.com/Bughunter-Geek/agentic-wear/releases/tag/v0.6.25-alpha). Follow the [alpha testing guide](docs/alpha-testing.md) for first installation, checksum verification, and signing precautions.

**The 0.6.25 delivery fixes also require the matching Mac bridge update.** Updating only the watch APK does not update the bridge. Follow the tagged setup instructions to rebuild the bridge and reinstall/restart its service.

### New self-hosted setup

Use a fresh directory rather than changing an existing working checkout:

```bash
git clone --branch v0.6.25-alpha --depth 1 \
  https://github.com/Bughunter-Geek/agentic-wear.git agentic-wear-alpha-0.6.25
cd agentic-wear-alpha-0.6.25
```

Then follow the **Prerequisites** and numbered setup sections in the [tagged README](https://github.com/Bughunter-Geek/agentic-wear/blob/v0.6.25-alpha/README.md): configure Firebase, deploy your relay, build and pair the bridge, and build/install the watch client for that deployment.

The documented build toolchain is Node.js 22+, JDK 17, Android SDK 37, and Android Studio. Automatic local Whisper setup requires an Apple-silicon Mac. The integration uses experimental Codex App Server surfaces documented against CLI 0.147.0; compatibility with later CLI versions must be checked rather than assumed.

Local Whisper does not incur a transcription API charge, but Codex usage and any chosen hosted transcription or infrastructure remain separate. Smart voice revision uses the bridge owner's Codex allowance.

## Architecture and privacy

```text
Wear OS watch ⇄ encrypted relay + FCM wake ⇄ private macOS bridge ⇄ Codex App Server
                                                   └──────────→ local Whisper
```

Local transcription runs on the paired bridge owner's Mac. Hosted transcription is opt-in. Encryption protects application payloads through the relay, not compromised endpoints or all metadata: the relay can observe information such as timing and ciphertext sizes. Bridge-to-watch envelopes expire after 24 hours; offline watch audio is not queued by the relay.

The bridge observes sessions on its connected Codex daemon. It is not a direct iPhone-to-watch link and cannot observe unrelated ChatGPT conversations or a different Codex host.

Review the release's [Architecture](https://github.com/Bughunter-Geek/agentic-wear/blob/v0.6.25-alpha/docs/architecture.md), [Protocol](https://github.com/Bughunter-Geek/agentic-wear/blob/v0.6.25-alpha/docs/protocol.md), [Privacy](https://github.com/Bughunter-Geek/agentic-wear/blob/v0.6.25-alpha/PRIVACY.md), and [Security](https://github.com/Bughunter-Geek/agentic-wear/blob/v0.6.25-alpha/SECURITY.md) documentation before deployment. Do not publish pairing codes, credentials, private prompts, or unredacted logs.

## Known limits and useful testing

Real-watch reliability, battery impact, background delivery, and compatibility across watch/OS/Codex versions need device-specific evidence. An emulator result is not a substitute for those checks. The documented emulator baseline is a 454 × 454 round Wear OS 7 / Android 17 device.

External testers and contributors are welcome. Start with the [alpha testing guide](docs/alpha-testing.md), use synthetic prompts in a disposable project, and report the exact versions, reproduction steps, and observed result. The highest-value reports cover first-time setup, Send-button reachability, duplicate or stalled delivery, background alerts, and same-key updates. A useful result can be a failure report; no positive review is expected.

## Development

Run these commands from the checkout you intend to test after installing its dependencies:

```bash
npm --prefix bridge run check
npm --prefix bridge test
npm --prefix relay run check
npm --prefix relay test
./gradlew :wear:lintDebug :wear:assembleDebug
```

Read [Contributing](CONTRIBUTING.md) and the [release testing guide](https://github.com/Bughunter-Geek/agentic-wear/blob/v0.6.25-alpha/docs/testing.md). Preserve terminal-event notification rules, approval ownership boundaries, and signing identity. Build success, emulator QA, and physical-watch acceptance must be reported separately.

## License and acknowledgements

Apache-2.0. See [LICENSE](LICENSE).

Agentic Wear is independently implemented, with credit to projects that helped establish this category, including SmartCodex. See the release's [Acknowledgements](https://github.com/Bughunter-Geek/agentic-wear/blob/v0.6.25-alpha/ACKNOWLEDGEMENTS.md).
