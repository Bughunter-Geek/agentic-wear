#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Automatic signing setup currently supports macOS Keychain only." >&2
    exit 1
fi

command -v keytool >/dev/null || {
    echo "keytool is required; install JDK 17 or newer." >&2
    exit 1
}
command -v security >/dev/null || {
    echo "macOS Keychain command is unavailable." >&2
    exit 1
}
command -v openssl >/dev/null || {
    echo "openssl is required to generate a strong signing password." >&2
    exit 1
}

signing_dir="${AGENTIC_WEAR_SIGNING_DIR:-$HOME/Library/Application Support/Agentic Wear}"
signing_file="$signing_dir/release.jks"
keychain_service="io.github.sirbughunter.agenticwear.release-signing"
keychain_account="release-key"
key_alias="agentic-wear"

if [[ -e "$signing_file" ]]; then
    echo "Refusing to replace the existing Agentic Wear release key: $signing_file" >&2
    exit 1
fi

install -d -m 0700 "$signing_dir"
temporary_dir=$(mktemp -d "$signing_dir/.signing-setup.XXXXXX")
trap 'rm -rf -- "$temporary_dir"' EXIT
temporary_key="$temporary_dir/release.jks"
password=$(openssl rand -base64 36 | tr -d '\n')

keytool -genkeypair -noprompt \
    -keystore "$temporary_key" \
    -storetype PKCS12 \
    -storepass "$password" \
    -keypass "$password" \
    -alias "$key_alias" \
    -keyalg RSA \
    -keysize 4096 \
    -validity 10000 \
    -dname "CN=Agentic Wear, OU=Release, O=Bughunter Geek, C=DE" >/dev/null

security add-generic-password -U \
    -s "$keychain_service" \
    -a "$keychain_account" \
    -w "$password" >/dev/null

install -m 0600 "$temporary_key" "$signing_file"

echo "Created the Agentic Wear release identity."
echo "Keystore: $signing_file"
echo "Password: stored in macOS Keychain (never printed)"
echo "Back up both the keystore and its Keychain password before public release."
