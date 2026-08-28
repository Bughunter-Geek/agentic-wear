# Security policy

## Supported version

Only the latest commit on `main` is supported before the first tagged release.

## Reporting a vulnerability

Please use GitHub’s private security-advisory flow instead of opening a public issue. Do not include production credentials, private prompts, session titles, or decrypted relay payloads in a report.

## Trust boundaries

- The Wear OS app and bridge mutually authenticate their public keys with proofs derived from the locally generated one-time code. Neither endpoint persists the peer key until its proof verifies.
- The macOS bridge stores its private key and relay credential in Keychain. Its OpenAI key stays in the local environment.
- The relay authenticates both endpoints but is not trusted with content. Payloads use P-256 ECDH, HKDF-SHA-256, and AES-256-GCM with route metadata as authenticated additional data.
- The relay operator can observe timing, ciphertext sizes, pair identifiers, and a Firebase Installation ID. It cannot decrypt session names, prompts, transcripts, or alerts without compromising an endpoint.
- Firebase receives only an installation target and an `inbox.ready` wake message.
- OpenAI receives audio only when GPT Transcribe is selected.

The bridge generates each eight-character pairing code locally. PBKDF2-HMAC-SHA-256 derives a 256-bit authenticator, and role-separated HMAC proofs bind the pairing ID plus both endpoint public keys. The relay sees the derived pairing ID and proofs, but not the code. This is a deliberately compact human-entered secret rather than a formal PAKE; keep it private during its ten-minute, one-use lifetime.

Public pairing attempts pass through per-source and per-location Cloudflare rate limits, then a single admission object with an exact relay-wide attempt budget. Only a pairing ID previously issued by the authenticated start endpoint can allocate or reach its per-pair Durable Object. The relay accepts at most 500 simultaneous pending pairings and 120 completion attempts per minute by default.

Bridge-to-watch messages expire after 24 hours and are capped at 100 per pairing. The bridge records each authenticated watch envelope in an atomic, mode-0600 replay ledger before any Codex-side effect; claims survive restarts, concurrent bridge processes, and downstream delivery failures. The ledger rejects new commands after 10,000 live claims instead of evicting replay protection. Envelopes 24 hours old or more than five minutes in the future fail closed. Watch-to-bridge audio is rejected when the bridge is offline and is never persisted by the relay.

## Approval safety

Existing desktop/iPhone-controlled sessions are alert-only. The watch can approve or decline only requests for a thread created by that paired watch bridge. Unknown or stale approval IDs fail closed.

## Deployment checklist

- Rotate all example secrets and use a dedicated Firebase project.
- Restrict Cloudflare and Firebase administrative access with MFA.
- Keep `.env.local`, `.dev.vars`, Keychain exports, service-account JSON, signing stores, and Android `local.properties` out of Git.
- Review relay logs before enabling production sampling; application logs must never include decrypted payloads.
- Run the repository’s checks plus a secret scanner before every public push.
- Treat protocol-v1 pairing records as retired; upgrading requires an explicit fresh pairing with protocol v2.
