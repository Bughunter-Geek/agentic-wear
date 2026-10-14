# No-Play distribution

Agentic Wear can update directly on a Wear OS watch without a Google Play developer account. The intended path is:

1. Install one updater-enabled, release-signed APK over ADB.
2. Publish every later APK with the same signing key as GitHub Pre-release assets named `agentic-wear.apk` and `update.json`.
3. On the watch, open **Settings → App updates** and tap the available version.
4. The first time only, Agentic Wear explains the permission and opens Android's package installer. If Android blocks the update, tap **Settings** in that installer, enable **Install unknown apps** for Agentic Wear, and return. Agentic Wear resumes the verified installer; confirm the update there.

The updater checks two public release-manifest routes concurrently:

```text
https://raw.githubusercontent.com/Bughunter-Geek/agentic-wear/ota-alpha/update.json
https://api.github.com/repos/Bughunter-Geek/agentic-wear/contents/update.json?ref=ota-alpha
```

Each check has a 15-second overall deadline and can be restarted from the checking card. The last verified newer manifest is stored locally, survives a force-stop or offline relaunch, and is surfaced as an Update action on Home. Its source is cached too; private cached updates remain subject to pairing, opt-in and expiry checks. The app refreshes on launch and after returning to the foreground once the 15-minute refresh interval has elapsed.

Override the routes at build time with `AGENTIC_WEAR_UPDATE_MANIFEST_URL` and `AGENTIC_WEAR_UPDATE_MANIFEST_FALLBACK_URL` if the public repository changes.

## Prepare a release

Create the local macOS release identity once:

```bash
./scripts/setup-release-signing.sh
```

The keystore is stored under `~/Library/Application Support/Agentic Wear/` and its generated password in macOS Keychain. It is never tracked or printed. Back up both before public release: Android accepts an update only when it is signed by the installed app's trusted key.

CI and non-macOS maintainers can configure all four `ANDROID_RELEASE_*` values instead. Then increment both app version values and run:

```bash
AGENTIC_WEAR_VERSION_CODE=2 \
AGENTIC_WEAR_VERSION_NAME=0.1.1 \
AGENTIC_WEAR_RELEASE_TAG=v0.1.1-alpha \
./scripts/prepare-release.sh
```

The script refuses unsigned APKs and writes:

- `dist/agentic-wear.apk`
- `dist/update.json`

After reviewing those files, an authorized maintainer can publish them explicitly:

```bash
gh release create v0.1.1-alpha \
  dist/agentic-wear.apk \
  dist/update.json \
  --prerelease \
  --title "Agentic Wear Alpha 0.1.1" \
  --generate-notes
```

Copy the reviewed `update.json` to the public `ota-alpha` branch only after the
pre-release assets are live. Publishing is deliberately not part of the
preparation script, so a local build can never become public accidentally.

## Security boundaries

The updater accepts HTTPS only in release builds. It limits manifest and APK sizes, verifies the SHA-256 digest, checks the package name and version, and requires the downloaded APK to share a signing certificate with the installed app. Wear OS's package installer performs its own signature and user-consent checks as the final authority.

Android does not allow an ordinary third-party app to install updates silently. `REQUEST_INSTALL_PACKAGES` lets Agentic Wear ask the system installer; it does not bypass the system confirmation. Android documents both [per-source install approval](https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls()) and [user intervention for package installation](https://developer.android.com/reference/android/content/pm/PackageInstaller.Session#commit(android.content.IntentSender)).

ADB remains a fallback and Android states that ADB installs do not require developer verification. A fixed `adb tcpip 5555` endpoint can reduce pairing friction temporarily, but it is not the distribution design because a reboot, network change, or debugging reset can invalidate it.

Wear OS 7 targets Android 17 / API 37. Android 17 blocks direct local-network traffic by default for apps targeting API 37 unless they request the broad `ACCESS_LOCAL_NETWORK` runtime permission. Agentic Wear intentionally avoids that permission: production update assets come from public HTTPS GitHub URLs, and the bridge communicates through the public HTTPS relay. Local emulator updater tests use ADB-reversed loopback instead.

## Android developer verification

As of August 2026, Android's first enforcement phase applies outside Google Play only to mobile and tablet form factors in selected regions, not Wear OS. Android also provides ADB and an advanced sideloading flow for unregistered apps. Recheck the official [developer verification FAQ](https://developer.android.com/developer-verification/guides/faq) before broad public distribution because the global rollout is scheduled to expand in 2027.

## Private-first testing after the bootstrap

Watch 0.6.39/build 121 is the public updater-only bootstrap. Install it using the
existing public App updates flow, verify the installed version on the physical
Watch, then enable **Settings → Private test updates**. The switch defaults off
and is scoped to the current pairing; disconnecting clears it. It does not grant
access to another pair. Public feeds remain enabled.

Private manifests and APKs require the paired Watch credential on the exact
HTTPS pair-scoped relay route. Private expiry is required and checked again
before downloading and installation. Every redirect is checked before sending
a credential. Public requests carry no pairing credential and cannot enter
private pair routes. The newest eligible version wins; public wins a tie. An
installed private version is not reinstalled when its identical APK is promoted.

Build later test candidates with a versionCode greater than the bootstrap and
keep the standard public URLs compiled into the same APK. Publish only to the
existing paired private relay first using `bridge/src/publish-private-update.ts`.
Keep the original APK and a local publication receipt containing `private: true`,
`published: true`, `versionCode`, `versionName`, `sha256`, `apkSize`, and the full
`sourceCommit`. Record the physical tester's acceptance separately with
`accepted: true`, `physicalWatch: true`, `versionCode` and the same `sha256`.
Never mark acceptance before the user verifies that exact installed build.

After explicit promotion approval, run `scripts/prepare-public-promotion.py`
with `--apk`, `--private-receipt`, `--acceptance`, `--tag` and a new `--out`
directory. This validates the original signer, package, version, receipts and
hash, copies the APK byte for byte and prepares a public manifest. It never
builds, uploads or changes OTA. Publish those verified assets as an Alpha
prerelease with `--latest=false`, then advance the public OTA manifest and verify
both live routes. Rebuilding for promotion invalidates the acceptance receipt.

The temporary bootstrap prerelease may be withdrawn only after verified Pixel
Watch installation and a separate action-time approval identifying the exact
release and asset/OTA consequences. Preserve source commits, its tag and other
releases. Keep public OTA pointing to a downloadable release; cached bootstrap
manifests and downloads also need consideration. Removing a public download
cannot revoke existing copies and is not private-feed access control.
