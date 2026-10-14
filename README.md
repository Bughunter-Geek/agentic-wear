# Agentic Wear

Speak to Codex, follow a session, and receive completion or permission alerts from a Wear OS watch. Agentic Wear is an unofficial Apache-2.0 companion; it is not affiliated with or endorsed by OpenAI.

## Alpha 1 limited tester release

Two packages, two versions:

- **Watch 0.6.38 — build 120:** [signed APK and update manifest](https://github.com/Bughunter-Geek/agentic-wear/releases/tag/v0.6.38-alpha).
- **Receiver / Mac companion 0.3.17:** [matching Mac ZIP](https://github.com/Bughunter-Geek/agentic-wear/releases/download/v0.6.38-alpha/agentic-wear-mac-0.3.17.zip), containing the Chrome receiver, native messaging helper, compiled Mac bridge and production dependency notices.

Use both matching packages. The temporary Watch 0.6.39 updater-only bootstrap download has been withdrawn; public OTA points to Watch 0.6.38/build 120. These are development builds, not production-stability claims. Local, Dot and ordinary-cloud voice have worked on the maintainer's physical setup; broader device/network acceptance remains incomplete. The current public release source is pinned at [v0.6.38-alpha](https://github.com/Bughunter-Geek/agentic-wear/tree/v0.6.38-alpha); an unpinned default-branch checkout may predate this implementation.

The current source and receiver have explicit per-browser Dot selection and no maintainer Dot default. A packaging guard checks the committed source and staged receiver. Older source tags, downloads and caches are unchanged and may retain the former default; use this release rather than rebuilding an old receiver. Historical tags are not rewritten.

## Private test updates

Existing testers who already installed Watch 0.6.39/build 121 can enable **Settings → Private test updates**. The switch defaults
off and includes only that authenticated pairing's private feed; it cannot
access another user's feed. Public updates remain available. The newest
eligible build wins, and a private build already installed is not reinstalled
when its identical APK is later promoted publicly.

The call-fix candidate is distributed through the authenticated private test feed;
public promotion awaits physical acceptance. The temporary bootstrap prerelease
was removed after the tester confirmed installation and approved removal. Its
Git tag and source history remain available. Removal cannot revoke downloaded
copies and does not grant access to another pairing's private feed.

## Installation instructions

Need help getting started? Ask your Codex agent to walk you through these installation instructions.

Start with **native live voice**. Phonon and Qwen are optional dictation tools; you do not need to install them to talk to your Dot.

### Before you start

You need a compatible Mac with Node.js 22+, Codex/native voice access, your own signed-in Chrome account, a Wear OS watch and an authorized relay/pairing setup. The Mac must stay awake and online. This developer Alpha is self-hosted: the ZIP contains the bridge, not a hosted account or automatic installer. For a new deployment, follow [self-hosted setup](docs/self-hosted-setup.md); existing testers should use their deployment owner's setup. Broader Watch/device compatibility remains unverified.

### Install and connect

1. **Mac:** download the matching [Mac 0.3.17 ZIP](https://github.com/Bughunter-Geek/agentic-wear/releases/download/v0.6.38-alpha/agentic-wear-mac-0.3.17.zip), extract it to a permanent folder, and follow [Mac package setup](docs/mac-package-setup.md). Configure the bridge, its default transcription dependency and native helper there. New installations need authenticated pairing; existing installations keep their private configuration, pairing and extension identity.
2. **Watch:** install [Watch 0.6.38/build120](https://github.com/Bughunter-Geek/agentic-wear/releases/tag/v0.6.38-alpha) and enter the pairing code/relay URL supplied by your own bridge. If already paired, update through **Settings → App updates** and confirm the system installer.
3. **Chrome:** enable **Agentic Wear Cloud Receiver**, also called **Relay**. Open your own Dot at `https://chatgpt.com/dots/home`. With no call active, open the Receiver popup and choose **Connect this Dot**. Opening the popup alone does not select it. Older packages may call this extension **Agentic Cloud Receiver**; it is separate from the relay server.
4. **Match the Dot:** the Mac's private target configuration must match the selected Dot. The popup stores selection locally in Chrome; it does not rewrite the Mac configuration. Missing or mismatched selection blocks Dot access. A new tester must finish both sides with their deployment owner.
5. **Verify the connection:** from the matching Mac package/source root, run `node bridge/dist/cli.js doctor` and `node bridge/dist/cli.js service status`. Confirm the established bridge is running, then open the Watch and confirm its chat list refreshes. Open your Dot in Chrome and try **Talk** on the Watch. For an ordinary cloud chat, keep its supported `chatgpt.com/local/...` page open with Relay enabled. Local Codex tasks use their native route.

Keep credentials and private Dot targets outside source/downloads. See [update instructions](#in-place-updates) before replacing an existing installation, and [distribution](docs/distribution.md)/[testing](docs/testing.md) for developer details.

## Choose how to speak

| Choice | What happens | Requirements |
| --- | --- | --- |
| **Talk / native live voice** | A live conversation with your selected Dot or local Codex task. Ordinary cloud chats use the Mac voice companion. | Awake, connected Mac; compatible Codex/account access; Chrome Receiver for browser chats/Dots. |
| **Phonon-2 dictation** | Watch records audio; your Mac recognizes English; you review the text and send it. | Optional [Phonon setup](docs/phonon-setup.md) on Apple silicon. Not a model running on the Watch. |
| **Private Whisper** | Mac transcription for multilingual record/review/send. | Separate Local Whisper setup; default bridge provider. |
| **Device speech** | The Watch opens its installed system speech recognizer, then you review/send its text. | A compatible device recognizer. Languages, network needs and any offline support depend on that provider. |

Phonon inference is local/offline **after** downloading its runtime and model. This does not make the full app offline: recorded Watch audio still travels through the paired encrypted relay to the Mac, and sending a prompt/live voice needs the corresponding online services. Qwen is a separate optional text-cleanup model; it does not recognize speech. Advanced model setup belongs in [Phonon instructions](docs/phonon-setup.md), not the native-voice installation path.

Opening the selected Dot on the Watch home or chat screen prepares one connection for up to 45seconds. Microphone recording and speaker playback stay inactive until Call. Preparation cancels when leaving the Dot or on expiry. Physical preparation and startup-speed acceptance of build 120 remain pending.

## In-place updates

Preserve the extension public key/ID, Chrome storage selection, native-host registration, helper bundle, watch pairing, signing identity and private configuration. Back up existing files privately. End calls before any approved extension reload or bridge restart. Never remove a working installation to apply a patch or load a lower-numbered receiver over it.

Receiver/Mac companion **0.3.17** is newer than both formerly documented receiver series. Keep one matching release version for the bridge, helper and extension; do not mix older components. This update does not replace the deployed relay service. The [provenance checkpoint](docs/receiver-provenance.md) records the previous mismatch without prescribing another version series.

Watch updates use **Settings → App updates**, verify checksum/package/version/signing identity, and require the owner's system-installer confirmation. Existing tester private updates do not publish a public Alpha or grant broad launch authority.

## Voice routes and limits

- **Local:** native Codex WebRTC voice attached to the selected local task. Tool availability follows that task/runtime. Cross-chat tools have their own scope; voice does not grant unrestricted access.
- **Dot:** Chrome owns account identity and native call creation/attachment; Watch WebRTC owns microphone/speaker media. Relay must be enabled and the same Dot selected/configured. Existing calls are not taken over.
- **Ordinary cloud:** a private ephemeral Mac voice companion forwards substantive requests to one selected cloud chat and speaks only its matched final reply. The cloud chat retains its model, settings and tools. The companion disables inherited local tools. Greetings/clarifications remain in the call; the full spoken transcript is not automatically saved to the cloud thread. Uncertain sends are not automatically repeated.
- **Dictation:** explicit record/review/send, separate from live voice. Local Whisper is the default; optional **Phonon-2** provides English dictation on an Apple-silicon Mac. Neither Phonon nor its model is installed by the Mac ZIP. See [Phonon installation and configuration](docs/phonon-setup.md), including the separate optional Qwen text-cleanup step, and [privacy](PRIVACY.md).

## Approval controls and known availability issues

All currently supported approval cards lack a complete authority display, so Alpha 1 keeps them **alert-only**, even if Watch controls were previously enabled in Settings. Review and decide in Codex. The bridge rejects direct/stale approval responses too; ownership checks remain intact. Native Codex approval and ordinary voice/chat continue on their existing routes.

The independent source audit found three issues. The incomplete-authority approval issue is contained in this matching Mac release. Two availability findings are deferred to Alpha 1.1: a malicious configured relay can exhaust bridge memory by flooding queued envelopes during slow work; sufficiently large Unicode chat history can exceed the native messaging byte limit and repeatedly disconnect receiver tabs/calls. No arbitrary execution or plaintext disclosure was demonstrated by that audit; it was partial coverage, not a claim that no vulnerabilities remain.

## Scope and release gate

Code targets `minSdk 31` and private live builds retain ARM32/ARM64. That is not proof of Wear OS 4 or all form factors. The documented visual baseline is a round Wear OS 7 watch; older OS versions, square displays, handover/reconnect and broader reliability remain tester-specific acceptance items. No emulator result substitutes for physical acceptance.

Before packaging, run `npm --prefix bridge run check:receiver-package`. The native-helper bundler and release preparation also run this guard against both committed receiver source and working files. It requires explicit selection files/storage and rejects literal Dot defaults without printing identifiers. Synthetic fixtures replace the known personal identifier; historical source is not rewritten.

**OpenAI distribution permission is still pending; this release does not claim approval or endorsement.** Free/open-source distribution does not establish platform or artwork rights. Bundled Dot-avatar rights are not established by this repository's license. A minimal tester candidate can omit those PNGs and use existing code-drawn neutral orbs; see [the omission path](docs/tester-avatar-omission.md). Neither this source correction nor working voice establishes redistribution permission or security clearance.
