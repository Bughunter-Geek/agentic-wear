# Agentic Wear

Speak to Codex, follow a session, and receive completion or permission alerts from a Wear OS watch. Agentic Wear is an unofficial Apache-2.0 companion; it is not affiliated with or endorsed by OpenAI.

## Alpha 1 limited tester release

Two packages, two versions:

- **Watch 0.6.38 — build 120:** [signed APK and update manifest](https://github.com/Bughunter-Geek/agentic-wear/releases/tag/v0.6.38-alpha).
- **Receiver / Mac companion 0.3.17:** [matching Mac ZIP](https://github.com/Bughunter-Geek/agentic-wear/releases/download/v0.6.38-alpha/agentic-wear-mac-0.3.17.zip), containing the Chrome receiver, native messaging helper, compiled Mac bridge and production dependency notices.

Use both matching packages. These are development builds, not production-stability claims. Local, Dot and ordinary-cloud voice have worked on the maintainer's physical setup; broader device/network acceptance remains incomplete. The release source is pinned at [v0.6.38-alpha](https://github.com/Bughunter-Geek/agentic-wear/tree/v0.6.38-alpha); an unpinned default-branch checkout may predate this implementation.

The current source and receiver have explicit per-browser Dot selection and no maintainer Dot default. A packaging guard checks the committed source and staged receiver. Older source tags, downloads and caches are unchanged and may retain the former default; use this release rather than rebuilding an old receiver. Historical tags are not rewritten.

## Tester prerequisites and setup

Use your own signed-in Chrome and Codex accounts, an awake/online compatible Mac companion, a paired watch, and the deployment owner's existing relay/Firebase setup. This is a self-hosted developer Alpha, not an install-and-go hosted service. Follow the matching [Mac package setup](docs/mac-package-setup.md), [self-hosted setup](docs/self-hosted-setup.md), [distribution](docs/distribution.md) and [testing](docs/testing.md) instructions. A tester handoff must include the matching Mac bridge revision; the Watch APK alone is insufficient.

1. Install the matching Mac bridge and native messaging helper, then pair the Watch using the existing authenticated pairing flow. Keep private configuration, Dot targets and credentials outside source and downloads.
2. In Chrome, enable **Agentic Wear Cloud Receiver**, also called **Relay**. Older public packages display **Agentic Cloud Receiver**. This extension is separate from the encrypted relay service.
3. Open your own Dot at `https://chatgpt.com/dots/home`. With no call active, open the extension popup and choose **Connect this Dot**. Opening the popup alone does not select a Dot. Selection stays in this browser's extension-local storage. Missing, malformed or mismatched selection blocks Dot history, sending and voice.
4. The Mac companion's private target configuration must match that Dot. Receiver selection does not automatically rewrite companion configuration. Finish both sides before testing; use the existing matching configuration for an in-place update.
5. For ordinary cloud chats, keep the selected supported `chatgpt.com/local/...` page open in Chrome with Relay enabled. Local Codex tasks use their native App Server route.

## In-place updates

Preserve the extension public key/ID, Chrome storage selection, native-host registration, helper bundle, watch pairing, signing identity and private configuration. Back up existing files privately. End calls before any approved extension reload or bridge restart. Never remove a working installation to apply a patch or load a lower-numbered receiver over it.

Receiver/Mac companion **0.3.17** is newer than both formerly documented receiver series. Keep one matching release version for the bridge, helper and extension; do not mix older components. This update does not replace the deployed relay service. The [provenance checkpoint](docs/receiver-provenance.md) records the previous mismatch without prescribing another version series.

Watch updates use **Settings → App updates**, verify checksum/package/version/signing identity, and require the owner's system-installer confirmation. Existing tester private updates do not publish a public Alpha or grant broad launch authority.

## Voice routes and limits

- **Local:** native Codex WebRTC voice attached to the selected local task. Tool availability follows that task/runtime. Cross-chat tools have their own scope; voice does not grant unrestricted access.
- **Dot:** Chrome owns account identity and native call creation/attachment; Watch WebRTC owns microphone/speaker media. Relay must be enabled and the same Dot selected/configured. Existing calls are not taken over. Opening the selected Dot prepares one connection for up to 45 seconds; microphone recording and speaker playback stay inactive until Call. Preparation cancels when leaving the Dot or on expiry. Physical startup-speed acceptance of this change remains pending.
- **Ordinary cloud:** a private ephemeral Mac voice companion forwards substantive requests to one selected cloud chat and speaks only its matched final reply. The cloud chat retains its model, settings and tools. The companion disables inherited local tools. Greetings/clarifications remain in the call; the full spoken transcript is not automatically saved to the cloud thread. Uncertain sends are not automatically repeated.
- **Dictation:** explicit record/review/send, separate from live voice; local Whisper is the default transcription route. See [privacy](PRIVACY.md) for external media and data flows.

## Approval controls and known availability issues

All currently supported approval cards lack a complete authority display, so Alpha 1 keeps them **alert-only**, even if Watch controls were previously enabled in Settings. Review and decide in Codex. The bridge rejects direct/stale approval responses too; ownership checks remain intact. Native Codex approval and ordinary voice/chat continue on their existing routes.

The independent source audit found three issues. The incomplete-authority approval issue is contained in this matching Mac release. Two availability findings are deferred to Alpha 1.1: a malicious configured relay can exhaust bridge memory by flooding queued envelopes during slow work; sufficiently large Unicode chat history can exceed the native messaging byte limit and repeatedly disconnect receiver tabs/calls. No arbitrary execution or plaintext disclosure was demonstrated by that audit; it was partial coverage, not a claim that no vulnerabilities remain.

## Scope and release gate

Code targets `minSdk 31` and private live builds retain ARM32/ARM64. That is not proof of Wear OS 4 or all form factors. The documented visual baseline is a round Wear OS 7 watch; older OS versions, square displays, handover/reconnect and broader reliability remain tester-specific acceptance items. No emulator result substitutes for physical acceptance.

Before packaging, run `npm --prefix bridge run check:receiver-package`. The native-helper bundler and release preparation also run this guard against both committed receiver source and working files. It requires explicit selection files/storage and rejects literal Dot defaults without printing identifiers. Synthetic fixtures replace the known personal identifier; historical source is not rewritten.

**OpenAI distribution permission is still pending; this release does not claim approval or endorsement.** Free/open-source distribution does not establish platform or artwork rights. Bundled Dot-avatar rights are not established by this repository's license. A minimal tester candidate can omit those PNGs and use existing code-drawn neutral orbs; see [the omission path](docs/tester-avatar-omission.md). Neither this source correction nor working voice establishes redistribution permission or security clearance.
