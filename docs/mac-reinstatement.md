# Reinstating a self-hosted Mac setup

Use this after a macOS update, a new user account or a new Mac broke the
Watch connection. It records what was needed to bring a real self-hosted
setup back, generalized so other testers and coding agents can follow it.
The commands are in [`scripts/mac-reinstate/`](../scripts/mac-reinstate/).

Never paste secrets into a chat, issue or pull request. Every secret below lives
in a file or in Keychain on the Mac, and the scripts read them without printing them.

## 1. Topology

```
Watch app
   │ HTTPS
   ▼
zrok reserved share  https://<reserved-name>.shares.zrok.io
   │ zrok tunnel process on the Mac
   ▼
Self-hosted relay (workerd) on 127.0.0.1:8789   ← pairings, ciphertext queue, private updates
   ▲ WebSocket / HTTPS
   │
Bridge (node) ── Codex app server (ChatGPT.app's bundled codex)
   │ native messaging
   ▼
Chrome "Agentic Wear Cloud Receiver" (Dot / cloud-chat voice)
```

A Cloudflare deployment can replace the zrok + local relay pair, but only when
its relay code matches the Watch and bridge release. A Cloudflare Worker left
behind as a migration forwarder still runs its own, possibly older, relay code
for everything it does not forward.

### Versions must match

Watch build, Mac bridge and relay code come from the same release. The public
Mac 0.3.17 ZIP matches public Watch 0.6.38 / build 120 only. A private tester
Watch build needs its matching private bridge and relay.

Symptoms of a mismatch:
- The Watch shows "Couldn't refresh, check connection", and **no request reaches
  any relay log**.
- A newer bridge connects and then exits with `Invalid request` against an older relay.

Check the installed Watch build over adb (see §5):
`adb shell dumpsys package io.github.sirbughunter.agenticwear | grep -E 'versionName|versionCode'`.

## 2. Layout the script expects

All paths are relative to `$HOME`, so the same layout works on an old and a new
account. Override any of them with the variables in brackets.

| What | Default | Variable |
|---|---|---|
| Node 22 | `~/.local/node` (no Homebrew needed) | — |
| Bridge | `~/Library/Application Support/Agentic Wear/bridge` | `AW_BRIDGE_REL` |
| Bridge settings | `~/Library/Application Support/Agentic Wear/.env.local` | `AW_ENV_FILE` |
| Self-hosted relay | `~/Library/Application Support/Agentic Wear/self-hosted-relay` | `AW_RELAY_REL` |
| Relay state | `~/Library/Application Support/Agentic Wear/relay-state` | `AW_STATE_REL` |
| zrok binary | `~/.local/bin/zrok2` | `AW_ZROK_REL` |
| zrok environment | `~/.zrok2` | — |
| Reserved zrok name | *(required)* | `AW_ZROK_NAME` |
| Codex CLI | `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex` | `AW_CODEX_PATH` |

Pairing: `~/.agentic-wear/config.json` and Keychain service
`io.github.sirbughunter.agenticwear.bridge`. Dot target:
`~/.agentic-wear/desktop-cloud.json` (mode 600, directory 700).

LaunchAgents (`RunAtLoad` + `KeepAlive`), written by the script:

| Label | Runs |
|---|---|
| `io.agentic-wear.relay-server` | `node <relay>/server.mjs start --state=<relay-state> --port=8789` |
| `io.agentic-wear.relay-zrok` | `zrok2 share public http://127.0.0.1:8789 -n public:<name> --headless --force-local` |
| `io.github.sirbughunter.agenticwear.bridge` | `node <bridge>/bridge/dist/cli.js start` |

Every plist sets `PATH` with Node's directory first, plus `AGENTIC_WEAR_ENV_FILE`
and `AGENTIC_WEAR_CODEX_PATH` for the bridge.

## 3. Run it

```sh
export AW_ZROK_NAME=agentic-wear-xxxxxxxx
bash scripts/mac-reinstate/reinstate.sh                                   # services only
bash scripts/mac-reinstate/reinstate.sh --migrate-from "/Volumes/Macintosh HD/Users/<old-user>"
bash scripts/mac-reinstate/reinstate.sh --pair                            # new Watch pairing
```

The script can be run repeatedly. Anything it replaces is kept as
`*.before-reinstate-<time>`. In order, it sets up Node, copies from the old home
(optional; this includes `.env.local`, and an existing one is never overwritten), fixes the Codex config, applies the bridge schema fix, writes the
relay, zrok and bridge LaunchAgents, runs the health checks, pairs (optional)
and registers the Chrome native host.

After `--pair`, on the Watch: **Settings → Disconnect bridge**, enter the code,
and type the relay URL exactly as `https://<reserved-name>.shares.zrok.io`.
Then re-run `setup-dot-target.mjs`, because the Dot config is bound to the pairing.

## 4. Health checks

```sh
curl -s http://127.0.0.1:8789/health                                       # local relay
curl -s -A "OpenAI File Downloader, XaiImageApiFetch/1.0" \
     "https://$AW_ZROK_NAME.shares.zrok.io/health"                         # tunnel
tail -n 20 ~/.agentic-wear/bridge.stdout.log                               # expect relay.socket.connected
```

Expected: `{"ok":true,"service":"agentic-wear-relay","version":1}`. zrok's HTML
pages mean: **bad gateway**, the share exists but the local relay is down;
**not found**, no active share.

## 5. Failures we hit, with cause and fix

1. **New user account after an OS update.** `/Users/<old-user>` can become a
   root-owned stub while the real data sits at `/Volumes/Macintosh HD/Users/<old-user>`.
   Copy with `sudo ditto`, then `chown -R $USER:staff`. When rewriting paths, match
   `/Users/<old-user>/` *with* the trailing slash, because the old name can be a
   prefix of the new one.
2. **Homebrew gone.** That means no `node` and no `ffmpeg`. The script installs
   the official Node 22 tarball, checksum-verified, into `~/.local/node`.
3. **LaunchAgent PATH** defaults to `/usr/bin:/bin:/usr/sbin:/sbin`. npm-installed
   tools with `#!/usr/bin/env node` then exit with code 1. `agentic-wear service install`
   currently writes no `PATH`, so set it after running that command.
4. **Local Whisper not installed.** The bridge exits at start. Set
   `AGENTIC_WEAR_TRANSCRIPTION_PROVIDER=openai`, or install ffmpeg and run `transcription setup`.
5. **Codex is bundled in ChatGPT.app.** The npm CLI did not expose realtime voice
   in our test. Start the bundled app server daemon once with
   `"$CODEX" app-server daemon start`.
6. **Codex config.** Add
   `experimental_realtime_webrtc_call_base_url = "https://chatgpt.com/backend-api/codex"`
   at the top of `~/.codex/config.toml`. Do not carry over an `openai_base_url` that
   points at a local proxy that no longer runs.
7. **"Codex realtime API is unavailable" although voices exist.** Codex 0.166 adds
   a `v3` voice list, and a strict `realtimeVoiceListResponseSchema` rejects it.
   The script relaxes the inner `voices` object. Verify with `codex-voice-probe.mjs`.
8. **Chrome popup says "Open your Dot page first".** ChatGPT now redirects
   `/dots/home` to `/dots/<account>~<dot>`, and older receivers only match the exact
   old URL. Run `node scripts/mac-reinstate/patch-dot-url.mjs <extension dir>`,
   then reload the extension and the tab.
9. **Native host registration fails with EPERM** under
   `~/Library/Application Support/Google/Chrome`. Chrome hasn't run on this account
   yet. Open it once, then run `register-receiver-host.mjs --apply`.
10. **Dot target missing.** Run
    `node scripts/mac-reinstate/setup-dot-target.mjs "<Dot URL>" "<Dot name>"`.
    It binds `pairBinding` to the current pairing.
11. **Old relay supervisor crash-loops silently.** Its integrity pins included an
    absolute Homebrew Node path. The script replaces it with two plain
    LaunchAgents and keeps the old plist as `.disabled`.
12. **zrok says "the zrok service is busy" for every share.** A VPN blocked
    zrok's OpenZiti data connections while the API calls still worked. Exclude
    `zrok2` from the VPN (split tunnel) or disconnect it.
13. **"… in use by share `<token>`".** A stale share from the old OS holds the
    reserved name. Run `zrok2 overview`, then `zrok2 delete share <token>`. The name
    stays reserved to the account. zrok v2 has no `release` command.
14. **zrok environment from the old OS.** Re-enable it with the account token
    already stored in `~/.zrok2/environment.json`: `zrok2 disable`, then
    `zrok2 enable "$TOKEN"`. Read the token into a variable and never print it.
15. **Pairing.** *Disconnect bridge* on the Watch discards its pairing. Pair
    against the relay the Watch build expects. The self-hosted relay's bootstrap
    secret is `bindings.PAIRING_BOOTSTRAP_SECRET` in its state settings. A wrong or
    trailing-slash relay URL on the Watch shows "Relay request failed".
16. **Cloudflare pitfalls,** if you edit a Worker:
    - Dashboard variable edits are easy to put on the wrong variable.
    - `openssl … | pbcopy` copies a trailing newline into the secret.
    - Piping into `wrangler secret put` fails with "non-interactive".
    - After a rollback, use `wrangler versions secret bulk <file>` and then
      `wrangler versions deploy <id>@100% -y`.

## 6. Diagnostics

- **Relay request log:** `npx wrangler tail <worker> --format pretty` for
  Cloudflare, or `~/.agentic-wear/relay-logs/` for the self-hosted relay. Prove the
  log works with a `curl …/health` first.
- **Watch over Wi-Fi:** download platform-tools from
  `dl.google.com/android/repository/platform-tools-latest-darwin.zip`. On the Watch,
  open Developer options and turn on Wireless debugging, then choose
  **Pair new device**. Run `adb pair <ip>:<pair-port> <code>`, then
  `adb connect <ip>:<port>`. Use the Watch's numeric IP. The app logs little about
  network errors, so rely on `dumpsys package` and `adb shell ping`.
- **Codex voice:** `node scripts/mac-reinstate/codex-voice-probe.mjs` prints the
  server version, the raw `thread/realtime/listVoices` result and the plan type.
- **Bridge in the foreground:** `launchctl bootout gui/$(id -u)/<label>`, run
  `node bridge/dist/cli.js start` with the same environment, then `launchctl bootstrap` again.

## 7. Follow-ups for the source tree

- Accept `voices.v3` and unknown keys in `realtimeVoiceListResponseSchema`, with a test.
- Make the receiver match `https://chatgpt.com/dots/*` in its manifest, `popup.js`,
  `content.js`, `worker.js`, `voice-hook.js` and `voice-controller.js`.
- Write `PATH` into the plist from `bridge/src/launchd.ts`.
- Resolve the supervisor's interpreter pins at install time, and log failures.
- State the Watch ↔ bridge ↔ relay version pairing in the release notes.
