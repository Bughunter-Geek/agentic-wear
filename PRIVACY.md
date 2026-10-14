# Privacy

Agentic Wear is self-hosted software. The deployment owner operates/configures its relay and Firebase project. Tester builds may use the maintainer’s existing deployment; this source repository is not a promise of a turnkey hosted service.

## Data processed

- Session identifiers, titles, status, prompts, transcriptions, completion details, approval summaries, and timestamps pass between the watch and local bridge with end-to-end encryption.
- Microphone audio is recorded to the watch cache, deleted after the encrypted request reaches the online bridge or the request fails, and decoded and transcribed in bridge memory by default. For dictation, audio leaves the bridge host for transcription only when the owner selects hosted transcription. Live voice uses the separate external media routes below.
- The relay stores encrypted bridge-to-watch envelopes for up to 24 hours. It does not store watch-to-bridge audio or prompts.
- Firebase Cloud Messaging receives a Firebase Installation ID, opaque pair ID, and content-free wake signal.
- The bridge reads Codex session metadata and terminal events from the local managed Codex App Server.

## Live voice and browser receiver

- Local and ordinary-cloud companion calls use native Codex/OpenAI voice endpoints. Dot calls use the signed-in ChatGPT native voice endpoint. Watch microphone/speaker media travels by WebRTC to that endpoint; watch–bridge signaling encryption does not make voice audio local-only. Account/provider processing and retention apply.
- Chrome owns Dot login and native call control. Agentic Wear Cloud Receiver (Relay) reads only supported configured/selected pages. Dot selection is explicit through Connect this Dot and stored in extension-local Chrome storage. Missing/mismatched selection fails closed. Private target configuration must independently match the same Dot.
- The ordinary-cloud voice companion receives bounded recent selected-chat context (up to eight user/assistant messages, 800 characters each) and the current model/effort labels. It is a private ephemeral thread with inherited local tools disabled. One scoped tool forwards substantive requests through the receiver to the selected cloud chat and returns its matched final answer. Full spoken transcripts are not automatically written into that chat; greetings/clarifications stay in the voice session.
- Ending a call stops its owned voice session; it does not retract already submitted chat messages or promise deletion from external providers. Uncertain sends are not automatically repeated. Diagnostics must not log raw audio, SDP, credentials or conversation text.

## Local storage

The watch stores encrypted pairing credentials, recent encrypted-delivery results after decryption, up to 20 recent alerts, and up to 100 handled event IDs. The bridge stores non-secret configuration in `~/.agentic-wear/config.json`; private credentials are stored in macOS Keychain.

## Deletion

Disconnecting in the watch app removes pairing and cached app state. `agentic-wear service uninstall` removes the background service but intentionally preserves Keychain/config data. Relay data disappears automatically when its queue TTL expires; a deployment owner may also delete its Durable Object namespace.

Firebase, Cloudflare, and Codex account retention are governed by the deployment owner’s accounts and policies. OpenAI API retention applies to optional hosted transcription; Codex/ChatGPT account and native voice processing also apply to live voice and companion context. Provider-side retention/deletion is outside this app’s local deletion controls.

Advance Dot preparation is short-lived (at most 45 seconds) and uses the same Watch peer for the eventual call. Before explicit Call, the Watch creates no microphone track or audio source and keeps recording and playback disabled. The native signed-in browser client retains authentication, allocation and cleanup. Preparation does not cache account credentials or persist SDP. Leaving the Dot, expiry or connection loss releases the owned preparation.
