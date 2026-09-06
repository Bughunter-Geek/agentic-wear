#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 WATCH_SERIAL_OR_IP:PORT /path/to/signed.apk" >&2
    echo "Pair/connect with wireless ADB first. This script never publishes an APK." >&2
    exit 2
fi
serial=$1
apk=$2
command -v adb >/dev/null || { echo "Install Android SDK Platform Tools (adb) first." >&2; exit 1; }
[[ -n "$serial" && "$serial" != -* ]] || { echo "A specific watch serial is required." >&2; exit 2; }
[[ -f "$apk" && "$apk" == *.apk ]] || { echo "APK not found: $apk" >&2; exit 2; }
# An absolute path also prevents an APK filename from being parsed as a flag.
apk="$(cd -- "$(dirname -- "$apk")" && pwd)/$(basename -- "$apk")"
state=$(adb -s "$serial" get-state)
[[ "$state" == "device" ]] || { echo "The selected watch is not connected/authorized." >&2; exit 1; }
features=$(adb -s "$serial" shell pm list features)
if ! grep -q '^feature:android.hardware.type.watch' <<<"$features"; then
    echo "The selected device does not identify as a watch; installation refused." >&2
    exit 1
fi

echo "Installing locally to $serial. No release upload, uninstall, or downgrade is requested."
if ! adb -s "$serial" install -r "$apk"; then
    echo "Installation failed. Check the package, version and signing key; do not uninstall to bypass a mismatch." >&2
    exit 1
fi
echo "APK installation succeeded. Launch Agentic Wear and check pairing, sending, transcription and alerts separately."
