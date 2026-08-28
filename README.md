# Agentic Wear

Agentic Wear is an unofficial, open-source Wear OS companion for Codex. Hold to speak to an agent, switch sessions, and receive a strong watch alert only when a complete turn finishes, fails, is interrupted, or needs permission.

It is not affiliated with or endorsed by OpenAI. “Codex” is used only to describe compatibility with the Codex App Server.

## What works in v0.1

- Push-to-talk prompts with a review-before-send transcript.
- GPT Transcribe by default; Wear OS device speech is an optional fallback.
- Recent Codex session picker with exact session titles and state.
- One continuous one-second vibration when a full response completes.
- Distinct permission and error vibration patterns with amber/red alert states.
- Exact completion time and session name in every alert.
- Alert-only approvals for existing sessions; accept/decline controls only for sessions created by the watch.
- End-to-end encrypted watch↔bridge payloads through a small Cloudflare Durable Object relay.
- Endpoint-authenticated pairing: the relay never receives the human-readable pairing code and cannot silently replace either endpoint key.
- A background macOS bridge that reconnects automatically with `launchd`.

Agentic Wear never treats reasoning paragraphs, item completion, streamed text, or tool progress as a finished response. Live notifications use `turn/completed`; a 20-second reconciliation loop checks only persisted terminal turn states as a delivery fallback.

## Architecture

```text
Pixel Watch  ⇄  encrypted relay + FCM wake  ⇄  macOS bridge  ⇄  Codex App Server
                                                     └──────→ OpenAI transcription
```

The relay stores only encrypted bridge-to-watch envelopes for up to 24 hours. Watch audio is forwarded only while the bridge is online and is never queued by the relay. FCM receives a content-free wake signal; session titles, transcripts, prompts, and alert details remain encrypted in transit through the relay.

The bridge connects to the managed Codex App Server over its local Unix WebSocket. This lets it observe sessions run through that same managed daemon, including Codex remote-control sessions from an iPhone. It is not a direct iPhone-to-watch connection, and it cannot observe unrelated ChatGPT conversations or a different Codex host.

See [Architecture](docs/architecture.md), [Protocol](docs/protocol.md), [Roadmap](ROADMAP.md), [Privacy](PRIVACY.md), and [Security](SECURITY.md) before running a public deployment.

## Prerequisites

- macOS host running Codex CLI 0.147.0 or newer.
- Node.js 22+, JDK 17, Android SDK 37, and Android Studio.
- A Wear OS 4+ watch (minimum API 31).
- Your own Cloudflare and Firebase projects.
- A dedicated OpenAI API key for transcription.

## 1. Configure Firebase

Create a Firebase Android app with package name `io.github.sirbughunter.agenticwear`. Create a service-account key for the relay, then keep the downloaded client config outside the repository and point the uncommitted `local.properties` file to it:

```properties
AGENTIC_WEAR_FIREBASE_CONFIG_FILE=/absolute/path/to/google-services.json
```

Alternatively, provide the four client values individually through uncommitted `local.properties`, Gradle properties, or environment variables:

```properties
AGENTIC_WEAR_FIREBASE_APPLICATION_ID=1:123456789:android:example
AGENTIC_WEAR_FIREBASE_PROJECT_ID=your-project-id
AGENTIC_WEAR_FIREBASE_API_KEY=your-android-api-key
AGENTIC_WEAR_FIREBASE_SENDER_ID=123456789
AGENTIC_WEAR_RELAY_URL=https://agentic-wear-relay.example.workers.dev
```

The app initializes Firebase programmatically, so `google-services.json` never needs to be copied into the repository. Pairing still works when these values are absent, but background push alerts do not; the watch can only sync while the app is active until Firebase is configured.

Official builds default to `https://agentic-wear-relay.cleanuxlabs.workers.dev`, so watch users do not have to type a relay URL. Set `AGENTIC_WEAR_RELAY_URL` only when building against a different private deployment.

## 2. Deploy your relay

```bash
npm --prefix relay ci
cd relay
npx wrangler secret put PAIRING_BOOTSTRAP_SECRET
npx wrangler secret put PAIRING_CREDENTIAL_SECRET
npx wrangler secret put FIREBASE_PROJECT_ID
npx wrangler secret put FIREBASE_CLIENT_EMAIL
npx wrangler secret put FIREBASE_PRIVATE_KEY
npx wrangler deploy
```

Use separate random values of at least 32 characters for the two pairing secrets. Never put the Firebase private key or either secret in `wrangler.jsonc`.

## 3. Build and pair the bridge

Copy `.env.example` to `.env.local` at the repository root and fill in your own values. Then:

```bash
npm --prefix bridge ci
npm --prefix bridge run build
node bridge/dist/cli.js pair --relay https://your-relay.example.workers.dev --cwd /path/to/default/project
```

The bridge creates and displays an eight-character code locally. Enter it with the relay URL on the watch. The command waits until the watch and bridge have mutually authenticated both public keys; the relay only forwards their proofs and never receives the code. Finish with:

```bash
node bridge/dist/cli.js doctor
node bridge/dist/cli.js service install
```

The background service reads `.env.local`, stores its relay credential and ECDH private key in macOS Keychain, and reconnects after login or a crash. The pairing bootstrap credential may also be kept in Keychain under `relay-bootstrap-v1`; an explicit `AGENTIC_WEAR_BOOTSTRAP_SECRET` still takes precedence. The service does not place secrets in the launchd property list.

## 4. Build the watch app

```bash
./gradlew :wear:assembleDebug
adb install -r wear/build/outputs/apk/debug/wear-debug.apk
```

Wireless ADB is useful for the first install, but it is intentionally treated as temporary developer transport rather than permanent distribution infrastructure. Release builds include an opt-in updater in **Settings → App updates**. Alpha builds follow the public `ota-alpha` manifest and download signed APKs from GitHub Pre-releases, verify their checksum, package name, version, and signing certificate, then open Wear OS's system installer. No Play Console account or future ADB pairing is required.

Android still requires the watch owner to enable **Install unknown apps** for Agentic Wear once and confirm each update. Agentic Wear explains the handoff, then opens Android's package installer so the system can preserve the correct source-app context. If Android blocks the first install, use the installer's **Settings** action to enable Agentic Wear and return; Agentic Wear automatically resumes the verified installer. The app cannot and does not silently install software. The flow is verified on a 454 px round Wear OS 7 / Android 17 emulator. See [No-Play distribution](docs/distribution.md) for the exact workflow and security boundaries.

For the local maintainer build, create a permanent release identity once. The keystore remains outside the repository and its generated password is stored in macOS Keychain:

```bash
./scripts/setup-release-signing.sh
```

`prepare-release.sh` unlocks that identity automatically. Back up both the keystore and its Keychain password before publishing; losing the key permanently ends the existing update chain.

Other maintainers and CI environments can instead provide all four values through ignored `local.properties`, Gradle properties, or environment variables:

```properties
ANDROID_RELEASE_STORE_FILE=/absolute/path/to/agentic-wear.jks
ANDROID_RELEASE_STORE_PASSWORD=replace-me
ANDROID_RELEASE_KEY_ALIAS=agentic-wear
ANDROID_RELEASE_KEY_PASSWORD=replace-me
```

Then run `./gradlew :wear:assembleRelease`. If all four are absent, Gradle deliberately creates an unsigned local release; a partial signing configuration fails fast.

Prepare a signed GitHub Release payload with monotonically increasing version values:

```bash
AGENTIC_WEAR_VERSION_CODE=2 \
AGENTIC_WEAR_VERSION_NAME=0.1.1 \
AGENTIC_WEAR_RELEASE_TAG=v0.1.1-alpha \
./scripts/prepare-release.sh
```

This creates ignored `dist/agentic-wear.apk` and `dist/update.json` files. Publishing remains an explicit separate action.

## Development

```bash
npm --prefix bridge run check
npm --prefix bridge test
npm --prefix relay run check
npm --prefix relay test
./gradlew :wear:lintDebug :wear:assembleDebug
```

Read [Contributing](CONTRIBUTING.md) and [Testing](docs/testing.md) before opening a pull request.

## License

Apache-2.0. See [LICENSE](LICENSE).

## Acknowledgements

Agentic Wear is independently implemented, with thanks to projects that helped
establish this category. See [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md), including
our credit to [SmartCodex](https://github.com/Qualzz/SmartCodex).
