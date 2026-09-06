#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/.." && pwd)
cd "$repo_root"

: "${AGENTIC_WEAR_VERSION_CODE:?Set AGENTIC_WEAR_VERSION_CODE to a new value above the installed/public build}"
: "${AGENTIC_WEAR_VERSION_NAME:?Set AGENTIC_WEAR_VERSION_NAME for this private test build}"

if ! [[ "$AGENTIC_WEAR_VERSION_CODE" =~ ^[1-9][0-9]*$ ]]; then
    echo "AGENTIC_WEAR_VERSION_CODE must be a positive integer." >&2
    exit 2
fi

local_properties="$repo_root/local.properties"
local_value() {
    local key=$1
    [[ -f "$local_properties" ]] || return 0
    sed -n "s/^${key}=//p" "$local_properties" | tail -1
}

# build.gradle.kts intentionally gives local.properties higher precedence than
# environment variables. Refuse conflicting local values instead of silently
# preparing the wrong version/channel or re-enabling the public updater.
local_version_code=$(local_value AGENTIC_WEAR_VERSION_CODE)
local_version_name=$(local_value AGENTIC_WEAR_VERSION_NAME)
local_updates_enabled=$(local_value AGENTIC_WEAR_UPDATES_ENABLED)
local_release_channel=$(local_value AGENTIC_WEAR_RELEASE_CHANNEL)

if [[ -n "$local_version_code" && "$local_version_code" != "$AGENTIC_WEAR_VERSION_CODE" ]]; then
    echo "local.properties sets AGENTIC_WEAR_VERSION_CODE=$local_version_code, which overrides requested $AGENTIC_WEAR_VERSION_CODE." >&2
    echo "Update/remove that local.properties entry before building." >&2
    exit 1
fi
if [[ -n "$local_version_name" && "$local_version_name" != "$AGENTIC_WEAR_VERSION_NAME" ]]; then
    echo "local.properties sets AGENTIC_WEAR_VERSION_NAME=$local_version_name, which overrides requested $AGENTIC_WEAR_VERSION_NAME." >&2
    echo "Update/remove that local.properties entry before building." >&2
    exit 1
fi
if [[ -n "$local_updates_enabled" && "$local_updates_enabled" != "false" ]]; then
    echo "local.properties sets AGENTIC_WEAR_UPDATES_ENABLED=$local_updates_enabled and would override the private-build safety setting." >&2
    echo "Set it to false or remove the entry before building." >&2
    exit 1
fi
if [[ -n "$local_release_channel" && "$local_release_channel" != "Private internal" ]]; then
    echo "local.properties sets AGENTIC_WEAR_RELEASE_CHANNEL=$local_release_channel and would override the private channel label." >&2
    echo "Set it to 'Private internal' or remove the entry before building." >&2
    exit 1
fi

# Internal testing should be controlled by Google Play only. Do not let a private
# Play build also poll the public GitHub Alpha feed.
export AGENTIC_WEAR_UPDATES_ENABLED=false
export AGENTIC_WEAR_RELEASE_CHANNEL="Private internal"

signing_file="${AGENTIC_WEAR_SIGNING_KEYSTORE:-$HOME/Library/Application Support/Agentic Wear/release.jks}"
keychain_service="io.github.sirbughunter.agenticwear.release-signing"
keychain_account="release-key"

if [[ -z "${ANDROID_RELEASE_STORE_FILE:-}" &&
      -z "${ANDROID_RELEASE_STORE_PASSWORD:-}" &&
      -z "${ANDROID_RELEASE_KEY_ALIAS:-}" &&
      -z "${ANDROID_RELEASE_KEY_PASSWORD:-}" &&
      -f "$signing_file" ]]; then
    command -v security >/dev/null || {
        echo "macOS Keychain is required to unlock the existing Agentic Wear release key." >&2
        exit 1
    }
    signing_password=$(security find-generic-password -w -s "$keychain_service" -a "$keychain_account")
    export ANDROID_RELEASE_STORE_FILE="$signing_file"
    export ANDROID_RELEASE_STORE_PASSWORD="$signing_password"
    export ANDROID_RELEASE_KEY_ALIAS="agentic-wear"
    export ANDROID_RELEASE_KEY_PASSWORD="$signing_password"
fi

if [[ -z "${ANDROID_RELEASE_STORE_FILE:-}" ||
      -z "${ANDROID_RELEASE_STORE_PASSWORD:-}" ||
      -z "${ANDROID_RELEASE_KEY_ALIAS:-}" ||
      -z "${ANDROID_RELEASE_KEY_PASSWORD:-}" ]]; then
    echo "The existing release signing identity is not available. Refusing to create an unsigned or differently signed Play bundle." >&2
    exit 1
fi

./gradlew :wear:bundleRelease

bundle="$repo_root/wear/build/outputs/bundle/release/wear-release.aab"
if [[ ! -f "$bundle" ]]; then
    echo "Release bundle was not produced: $bundle" >&2
    exit 1
fi

command -v jarsigner >/dev/null || {
    echo "jarsigner is required to verify the signed app bundle." >&2
    exit 1
}
if ! jarsigner -verify "$bundle" >/dev/null 2>&1; then
    echo "The app bundle is not signed correctly; refusing to prepare it for Play." >&2
    exit 1
fi

dist_dir="$repo_root/dist"
mkdir -p "$dist_dir"
out="$dist_dir/agentic-wear-internal-${AGENTIC_WEAR_VERSION_CODE}.aab"
install -m 0644 "$bundle" "$out"
sha256=$(shasum -a 256 "$out" | awk '{print $1}')

cat <<EOF
Prepared private Google Play internal-test bundle:
  versionCode: $AGENTIC_WEAR_VERSION_CODE
  versionName: $AGENTIC_WEAR_VERSION_NAME
  channel:     $AGENTIC_WEAR_RELEASE_CHANNEL
  updater:     disabled
  bundle:      $out
  SHA-256:     $sha256

Nothing was uploaded or published.
EOF
