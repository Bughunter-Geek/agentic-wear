# Agentic Wear

Speak to Codex, follow a session, and receive completion or permission alerts from a Wear OS watch. Agentic Wear is an unofficial Apache-2.0 companion; it is not affiliated with or endorsed by OpenAI.

## Limited tester Alpha

The newest published Watch Alpha is [0.6.35, build 116](https://github.com/Bughunter-Geek/agentic-wear/releases/tag/v0.6.35-alpha). Private build 117 adds receiver-aware voice setup guidance for the existing tester. These are development builds, not production-stability claims. Local, Dot and ordinary-cloud voice have worked on the maintainer's physical setup; broader device and network acceptance remains incomplete.

This source correction is a review candidate based on v0.6.35. Its corrected receiver version is **0.3.15**. It has not been published as an installer or receiver ZIP. Use the reviewed clean source revision supplied with a tester handoff; do not build or package receivers from older source tags. Historical tags are unchanged and may retain the maintainer-specific Dot default.

The separately corrected [receiver ZIP on v0.6.30](https://github.com/Bughunter-Geek/agentic-wear/releases/download/v0.6.30-alpha/agentic-cloud-receiver-0.3.5.zip) internally reports **0.3.5.1** despite its original filename. It is not a replacement for a newer working installation or a complete matching Mac companion for current cloud voice.

## Tester prerequisites and setup

Use your own signed-in Chrome and Codex accounts, an awake/online compatible Mac companion, a paired watch, and the deployment owner's existing relay/Firebase setup. This is a self-hosted developer Alpha, not an install-and-go hosted service. Follow the matching [architecture](docs/architecture.md), [distribution](docs/distribution.md) and [testing](docs/testing.md) instructions. A tester handoff must include the matching Mac bridge revision; the Watch APK alone is insufficient.

1. Install the matching Mac bridge and native messaging helper, then pair the Watch using the existing authenticated pairing flow. Keep private configuration, Dot targets and credentials outside source and downloads.
2. In Chrome, enable **Agentic Wear Cloud Receiver**, also called **Relay**. Older public packages display **Agentic Cloud Receiver**. This extension is separate from the encrypted relay service.
3. Open your own Dot at `https://chatgpt.com/dots/home`. With no call active, open the extension popup and choose **Connect this Dot**. Opening the popup alone does not select a Dot. Selection stays in this browser's extension-local storage. Missing, malformed or mismatched selection blocks Dot history, sending and voice.
4. The Mac companion's private target configuration must match that Dot. Receiver selection does not automatically rewrite companion configuration. Finish both sides before testing; use the existing matching configuration for an in-place update.
5. For ordinary cloud chats, keep the selected supported `chatgpt.com/local/...` page open in Chrome with Relay enabled. Local Codex tasks use their native App Server route.

## In-place updates

Preserve the extension public key/ID, Chrome storage selection, native-host registration, helper bundle, watch pairing, signing identity and private configuration. Back up existing files privately. End calls before any approved extension reload or bridge restart. Never remove a working installation to apply a patch or load a lower-numbered receiver over it.

Some existing installations were documented as 0.3.14/0.3.14.1. A fresh local inspection instead found 0.3.5.2 with privacy-corrected scripts and the same extension key. The installation timeline is not established; do not infer it from a stale handoff. See [receiver provenance](docs/receiver-provenance.md). Any 0.3.14-series installation needs its own monotonically increasing maintenance version, not this lower-numbered public-series package.

Watch updates use **Settings → App updates**, verify checksum/package/version/signing identity, and require the owner's system-installer confirmation. Existing tester private updates do not publish a public Alpha or grant broad launch authority.

## Voice routes and limits

- **Local:** native Codex WebRTC voice attached to the selected local task. Tool availability follows that task/runtime. Cross-chat tools have their own scope; voice does not grant unrestricted access.
- **Dot:** Chrome owns account identity and native call creation/attachment; Watch WebRTC owns microphone/speaker media. Relay must be enabled and the same Dot selected/configured. Existing calls are not taken over.
- **Ordinary cloud:** a private ephemeral Mac voice companion forwards substantive requests to one selected cloud chat and speaks only its matched final reply. The cloud chat retains its model, settings and tools. The companion disables inherited local tools. Greetings/clarifications remain in the call; the full spoken transcript is not automatically saved to the cloud thread. Uncertain sends are not automatically repeated.
- **Dictation:** explicit record/review/send, separate from live voice; local Whisper is the default transcription route. See [privacy](PRIVACY.md) for external media and data flows.

## Scope and release gate

Code targets `minSdk 31` and private live builds retain ARM32/ARM64. That is not proof of Wear OS 4 or all form factors. The documented visual baseline is a round Wear OS 7 watch; older OS versions, square displays, handover/reconnect and broader reliability remain tester-specific acceptance items. No emulator result substitutes for physical acceptance.

Before packaging, run `npm --prefix bridge run check:receiver-package`. The native-helper bundler and release preparation also run this guard against both committed receiver source and working files. It requires explicit selection files/storage and rejects literal Dot defaults without printing identifiers. Synthetic fixtures replace the known personal identifier; historical source is not rewritten.

Platform distribution permission remains unconfirmed. Bundled Dot-avatar rights are not established by this repository's license. A minimal tester candidate can omit those PNGs and use existing code-drawn neutral orbs; see [the omission path](docs/tester-avatar-omission.md). Neither this source correction nor working voice establishes redistribution permission or security clearance.
