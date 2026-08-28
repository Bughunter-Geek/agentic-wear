# Privacy

Agentic Wear is self-hosted software. The repository does not operate a shared backend.

## Data processed

- Session identifiers, titles, status, prompts, transcriptions, completion details, approval summaries, and timestamps pass between the watch and local bridge with end-to-end encryption.
- Microphone audio is recorded to the watch cache, deleted after the encrypted request reaches the online bridge or the request fails, held in bridge memory for transcription, and sent to OpenAI only when GPT Transcribe is selected.
- The relay stores encrypted bridge-to-watch envelopes for up to 24 hours. It does not store watch-to-bridge audio or prompts.
- Firebase Cloud Messaging receives a Firebase Installation ID, opaque pair ID, and content-free wake signal.
- The bridge reads Codex session metadata and terminal events from the local managed Codex App Server.

## Local storage

The watch stores encrypted pairing credentials, recent encrypted-delivery results after decryption, up to 20 recent alerts, and up to 100 handled event IDs. The bridge stores non-secret configuration in `~/.agentic-wear/config.json`; private credentials are stored in macOS Keychain.

## Deletion

Disconnecting in the watch app removes pairing and cached app state. `agentic-wear service uninstall` removes the background service but intentionally preserves Keychain/config data. Relay data disappears automatically when its queue TTL expires; a deployment owner may also delete its Durable Object namespace.

OpenAI, Firebase, Cloudflare, and Codex account retention are governed by the deployment owner’s accounts and policies.
