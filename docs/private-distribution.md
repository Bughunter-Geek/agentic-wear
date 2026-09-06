# Private development distribution

A GitHub Pre-release on a public repository is **public**, not an invitation-only
beta. Do not publish a private APK or its manifest to this repository's Releases,
`ota-alpha` branch, or public build artifacts. Source changes and APK distribution
are separate decisions.

## Immediate private Wi-Fi installation

Use wireless ADB when the Mac and watch can communicate on the same trusted Wi-Fi
network. No APK hosting, Play account, USB cable or public release is required.
This is a wireless developer installation, not a persistent internet update service.
A Mac on a different network cannot use these LAN commands directly.

1. On the watch, enable Developer options, ADB debugging and Wireless debugging.
   Open **Pair new device** and use its pairing address and port:

   ```sh
   adb pair WATCH_IP:PAIRING_PORT
   ```

   Enter the displayed code interactively. Do not commit or share that code.

2. Return to the main Wireless debugging page. Its **connection port is usually
   different** from the pairing port:

   ```sh
   adb connect WATCH_IP:CONNECTION_PORT
   adb devices -l
   adb -s WATCH_IP:CONNECTION_PORT shell pm list packages | grep agenticwear
   adb -s WATCH_IP:CONNECTION_PORT shell dumpsys package io.github.sirbughunter.agenticwear | grep versionCode
   ```

3. Preserve the existing package ID and signing identity. The `.debug` package is a
   separate installation, not an update to the release package. Back up the
   existing keystore and its password securely. Do not generate a replacement key
   or uninstall the working app to bypass a signature mismatch.

4. In ignored `local.properties`, set:

   ```properties
   AGENTIC_WEAR_UPDATES_ENABLED=false
   AGENTIC_WEAR_RELEASE_CHANNEL=Private
   ```

   Also set `AGENTIC_WEAR_VERSION_CODE` to the next unused code above the installed
   version, and a corresponding private `AGENTIC_WEAR_VERSION_NAME`. The public
   0.6.25 release has code 51; do not assume that is the code currently installed
   on a development watch. Local properties override Gradle properties and
   environment variables in this repository.

5. With the existing signing identity configured/unlocked, prepare a local APK:

   ```sh
   ./scripts/prepare-release.sh
   ./scripts/install-private-ota.sh WATCH_IP:CONNECTION_PORT dist/agentic-wear.apk
   ```

   `prepare-release.sh` builds and verifies a signed APK. It also writes a local
   `dist/update.json` with a default GitHub URL; it does **not** upload either file.
   Keep both local. The install helper selects one device, refuses non-watch
   targets and uses `adb install -r`, without uninstall or downgrade flags.

6. Verify the new version and that pairing is preserved. Test a text send, a
   transcription, a revision, wrist-down recording and a background completion
   alert. Installation success is not proof that these flows work. Turn off
   wireless debugging afterward when not developing.

## Internet OTA without repeated ADB: Google Play internal testing

For private ongoing updates across different networks, use an **internal testing
track**, not open testing or production. A Play Console developer account and its
app setup are required. Add the Wear OS form factor and distribute only to an
internal tester list containing the intended Google account. Join through the
opt-in link using the account on the watch. Configure the Wear OS track and device
eligibility in Play Console rather than treating a phone artifact as a watch build.

For Agentic Wear, prepare the private bundle on the signing Mac with the helper
below. It requires an explicit new version code/name, unlocks the existing local
release key from macOS Keychain when available, disables the public in-app updater,
verifies that the resulting AAB is signed, and writes only to ignored `dist/`:

```sh
AGENTIC_WEAR_VERSION_CODE=52 \
AGENTIC_WEAR_VERSION_NAME=0.6.26-private1 \
bash scripts/prepare-internal-test.sh
```

Upload `dist/agentic-wear-internal-52.aab` to the Play Console **Internal testing**
track only after confirming the app-signing certificate configuration described
below. The helper itself never uploads or publishes the bundle.

The internal track supports up to 100 testers and does not make an otherwise
unpublished app discoverable by public Play search. Internal testers can be added
from any location. Keep the in-app public updater disabled for this channel so
Google Play controls updates.

Before moving an existing sideloaded installation to Play, check **app signing**,
not just the upload key. The APK delivered by Play must be signed by an identity
Android accepts as an update to the currently installed package. For a new Play
listing, do not simply accept a different generated app-signing key if preserving
the sideloaded installation matters: configure Play App Signing to use the existing
Agentic Wear app-signing key/certificate according to the current Play Console
flow before rolling out the internal release. Keep a secure backup of the original
keystore. Each update also needs a higher version code.

Publishing/review, developer-account verification, Play package-name registration,
and key-transfer steps can vary by account state. Treat any prompt that would
replace or rotate the app-signing identity as consequential and verify it before
continuing; do not uninstall the watch app as a workaround for a signature error.

## Custom private update servers

A custom primary manifest no longer silently enables the public GitHub fallback.
Both custom sources can be supplied explicitly. `AGENTIC_WEAR_UPDATES_ENABLED=false`
disables both sources for debug and release builds, even if URLs are configured.

**A custom hostname or an obscure URL is not access control.** The current updater
makes ordinary HTTPS requests without a private GitHub authorization flow. Merely
moving the APK to a private repository will not make authenticated download work.
Do not embed a personal GitHub token, service-account key or reusable account
credential in BuildConfig, the APK, a public manifest, or this repository.
An authenticated private updater needs a separately reviewed authorization design;
it is not implemented by the URL-isolation change.

## Sources

- Android Developers, [Debug Wear OS over Wi-Fi](https://developer.android.com/training/wearables/get-started/debug-wifi).
- Android Developers, [Android Debug Bridge](https://developer.android.com/tools/adb).
- Google Play Console Help, [Set up an open, closed, or internal test](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en).
- Google Play Console Help, [Use Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en).
- Android Developers, [Sign your app](https://developer.android.com/studio/publish/app-signing).

Instructions checked during the September 2026 review. No app was published or
installed on a physical watch as part of this documentation change.
