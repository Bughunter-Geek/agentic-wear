# Agentic Wear

This file is the source of truth for Agentic Wear-specific workflow. Global
Codex instructions still apply.

## Device access

- Assume the user's physical watch and phone are remote from the development
  Mac unless the user explicitly confirms current physical access.
- ADB, including wireless ADB, is developer transport for local validation. Do
  not ask the user for cable/ADB testing or treat it as the build handoff.

## Build delivery

- Agentic Wear's user-facing delivery channel is a signed public GitHub Alpha
  prerelease followed by the `ota-alpha/update.json` manifest. The standing
  authorization covers shipping completed fixes through this Alpha/OTA channel
  unless the user pauses it. Never promote Stable or Latest without explicit
  permission.
- Complete relevant local tests, release signing, monotonically increasing
  `versionCode` verification, changelog/release notes, updater-path checks, and
  secret review before publishing. A local build alone is not distribution.
- Publish the reviewed `agentic-wear.apk` and `update.json` release assets first,
  then advance `ota-alpha/update.json`. Verify the live raw manifest after its
  cache expires before saying the OTA is available.
- Remote physical-watch acceptance happens after OTA publication because the
  OTA is how the user receives the build. Until acceptance passes, describe the
  Alpha accurately as published but physically unverified; do not call it fully
  accepted, final, Stable, or Latest.

Follow `docs/testing.md`, `docs/distribution.md`, and
`scripts/prepare-release.sh` for the exact checks and artifact preparation.
