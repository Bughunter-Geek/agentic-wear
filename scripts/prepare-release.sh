#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/.." && pwd)
cd "$repo_root"

signing_file="${AGENTIC_WEAR_SIGNING_KEYSTORE:-$HOME/Library/Application Support/Agentic Wear/release.jks}"
keychain_service="io.github.sirbughunter.agenticwear.release-signing"
keychain_account="release-key"

if [[ -z "${ANDROID_RELEASE_STORE_FILE:-}" &&
      -z "${ANDROID_RELEASE_STORE_PASSWORD:-}" &&
      -z "${ANDROID_RELEASE_KEY_ALIAS:-}" &&
      -z "${ANDROID_RELEASE_KEY_PASSWORD:-}" &&
      -f "$signing_file" ]]; then
    command -v security >/dev/null || {
        echo "macOS Keychain is required to unlock the local release key." >&2
        exit 1
    }
    signing_password=$(security find-generic-password -w -s "$keychain_service" -a "$keychain_account")
    export ANDROID_RELEASE_STORE_FILE="$signing_file"
    export ANDROID_RELEASE_STORE_PASSWORD="$signing_password"
    export ANDROID_RELEASE_KEY_ALIAS="agentic-wear"
    export ANDROID_RELEASE_KEY_PASSWORD="$signing_password"
fi

./gradlew :wear:assembleRelease

release_dir="$repo_root/wear/build/outputs/apk/release"
metadata_file="$release_dir/output-metadata.json"
if [[ ! -f "$metadata_file" ]]; then
    echo "Release metadata was not produced: $metadata_file" >&2
    exit 1
fi
source_name=$(node -e '
const fs = require("fs");
const metadata = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const output = metadata.elements?.[0]?.outputFile;
if (typeof output !== "string" || /[\\/]/u.test(output)) process.exit(1);
process.stdout.write(output);
' "$metadata_file")
source_apk="$release_dir/$source_name"
if [[ ! -f "$source_apk" ]]; then
    echo "Release APK was not produced: $source_apk" >&2
    exit 1
fi

sdk_root=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
if [[ -z "$sdk_root" && -f "$repo_root/local.properties" ]]; then
    sdk_root=$(sed -n 's/^sdk\.dir=//p' "$repo_root/local.properties" | tail -1)
fi
if [[ -z "$sdk_root" ]]; then
    echo "Set ANDROID_SDK_ROOT or sdk.dir in local.properties." >&2
    exit 1
fi

apksigner=$(find "$sdk_root/build-tools" -mindepth 2 -maxdepth 2 -type f -name apksigner -print | sort -V | tail -1)
aapt2=$(find "$sdk_root/build-tools" -mindepth 2 -maxdepth 2 -type f -name aapt2 -print | sort -V | tail -1)
if [[ -z "$apksigner" || -z "$aapt2" ]]; then
    echo "Android build tools are incomplete; apksigner and aapt2 are required." >&2
    exit 1
fi

if ! "$apksigner" verify --verbose "$source_apk" >/dev/null; then
    echo "Release APK is unsigned or has an invalid signature: $source_apk" >&2
    exit 1
fi
badging=$("$aapt2" dump badging "$source_apk")
package_name=$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" <<<"$badging")
version_code=$(sed -n "s/^package:.*versionCode='\([^']*\)'.*/\1/p" <<<"$badging")
version_name=$(sed -n "s/^package:.*versionName='\([^']*\)'.*/\1/p" <<<"$badging")

if [[ "$package_name" != "io.github.sirbughunter.agenticwear" ]]; then
    echo "Unexpected release package: $package_name" >&2
    exit 1
fi
if [[ -z "$version_code" || -z "$version_name" ]]; then
    echo "Could not read release version metadata." >&2
    exit 1
fi

dist_dir="$repo_root/dist"
mkdir -p "$dist_dir"
install -m 0644 "$source_apk" "$dist_dir/agentic-wear.apk"
sha256=$(shasum -a 256 "$dist_dir/agentic-wear.apk" | awk '{print $1}')
apk_size=$(stat -f '%z' "$dist_dir/agentic-wear.apk")

UPDATE_FILE="$dist_dir/update.json" \
VERSION_CODE="$version_code" \
VERSION_NAME="$version_name" \
APK_SHA256="$sha256" \
APK_SIZE="$apk_size" \
node -e '
const fs = require("fs");
const manifest = {
  versionCode: Number(process.env.VERSION_CODE),
  versionName: process.env.VERSION_NAME,
  apkUrl: "https://github.com/Bughunter-Geek/agentic-wear/releases/latest/download/agentic-wear.apk",
  sha256: process.env.APK_SHA256,
  apkSize: Number(process.env.APK_SIZE),
};
fs.writeFileSync(process.env.UPDATE_FILE, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o644 });
'

echo "Prepared signed Agentic Wear v$version_name ($version_code):"
echo "  $dist_dir/agentic-wear.apk"
echo "  $dist_dir/update.json"
echo "  SHA-256 $sha256"
