# Self-hosted source setup — Alpha 1

Use source tag **v0.6.36-alpha**, Watch **0.6.36/build118** and Receiver/Mac companion **0.3.15**. These established deployment commands are for developer testers using their own infrastructure. They do not provision or distribute account/relay credentials automatically. Keep `.env.local`, Firebase client/service-account configuration, private Dot targets and signing secrets outside the repository. The public Watch APK uses the maintainer deployment; a separate self-hosted deployment may require a matching Watch build/configuration and its own signing identity.

## Prerequisites

- macOS host running Codex CLI 0.147.0 or newer.
- Node.js 22+, JDK 17, Android SDK 37, and Android Studio.
- A Wear OS 4+ watch (minimum API 31).
- Your own Cloudflare and Firebase projects.
- An Apple-silicon Mac for the automatic free Local Whisper setup. Hosted transcription is optional.

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
node bridge/dist/cli.js transcription setup
node bridge/dist/cli.js pair --relay https://your-relay.example.workers.dev --cwd /path/to/default/project
```

The one-time transcription setup installs Apple MLX Whisper into `~/.agentic-wear`, downloads the multilingual Whisper Large v3 Turbo model, and keeps it loaded while the bridge runs. Allow roughly 3 GB for its isolated runtime and model. Prompts have no per-minute API charge and audio is decoded and transcribed in bridge memory. Install `ffmpeg` first with `brew install ffmpeg` if setup asks for it.

To opt into OpenAI's paid hosted transcription instead, set `AGENTIC_WEAR_TRANSCRIPTION_PROVIDER=openai` and provide `OPENAI_API_KEY`. This is never the default.

The bridge creates and displays an eight-character code locally. Enter it with the relay URL on the watch. The command waits until the watch and bridge have mutually authenticated both public keys; the relay only forwards their proofs and never receives the code. Finish with:

```bash
node bridge/dist/cli.js doctor
node bridge/dist/cli.js service install
node bridge/dist/cli.js service status
```

The background service reads `.env.local`, stores its relay credential and ECDH private key in macOS Keychain, and reconnects after login or a crash. The pairing bootstrap credential may also be kept in Keychain under `relay-bootstrap-v1`; an explicit `AGENTIC_WEAR_BOOTSTRAP_SECRET` still takes precedence. The service does not place secrets in the launchd property list. If you work across multiple worktrees or lanes, `service status` warns if the running launchd service points to another checkout, and `service install` migrates the launchd job to the current checkout without modifying pairing or Keychain data.


## Receiver and Dot setup

Follow mac-package-setup.md. Register the same receiver native host, enable Agentic Wear Cloud Receiver (Relay), open your own Dot with no active call and choose Connect this Dot. The Mac private target configuration must independently match the selected Dot. Neither a receiver ZIP nor the popup alone establishes pairing/target authorization.

For ordinary cloud voice keep the selected supported cloud page open in Chrome; the matching Mac voice companion forwards requests to it. Local voice uses Codex App Server. Dictation is separate. Approval decisions remain on Codex in Alpha1. See README.md and PRIVACY.md for limitations and data flows.
