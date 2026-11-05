# Restore the Mac bridge after a macOS reinstall, beta upgrade or username change

The watch never talks to the Mac directly. It talks to the **cloud relay**
(Cloudflare Worker in `relay/`), and the **Mac bridge** (`bridge/`, the
"relay on the Mac") holds an outbound WebSocket to that same relay. Restoring
"the relay on the Mac" therefore means restoring the bridge, its LaunchAgent,
its config and its Keychain items. The cloud relay itself is unaffected by a
Mac upgrade and needs no redeploy.

## One command

From an existing checkout:

```sh
bash scripts/restore-relay-macos.sh
```

Or, with no checkout at all:

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/Bughunter-Geek/agentic-wear/main/scripts/restore-relay-macos.sh)
```

(Until this branch is merged, replace `main` in that URL with `claude/relay-oneshot-setup`.)

The script is idempotent. Re-run it as often as you like. It exits `0` when
everything is restored and `2` when it lists items still needed (usually a
secret). Preview without changing anything: `AGENTIC_WEAR_DRY_RUN=1 bash scripts/restore-relay-macos.sh`.

### What it does

1. **Finds the original install location.** It reads `WorkingDirectory` from
   the old LaunchAgent (`~/Library/LaunchAgents/io.github.sirbughunter.agenticwear.bridge.plist`)
   and remaps `/Users/bughunter/…` to `$HOME/…`. For example,
   `/Users/bughunter/Developer/agentic-wear` becomes `/Users/bughuntergeek/Developer/agentic-wear`.
   If there is no old plist it uses the checkout the script is running from,
   and otherwise `~/agentic-wear`. Override with `AGENTIC_WEAR_INSTALL_DIR=~/somewhere`.
2. **Installs dependencies**: Xcode Command Line Tools (git), Node.js 22+ via
   Homebrew, and the Codex CLI (`npm i -g @openai/codex`) when they are missing.
   It does not install Homebrew itself. If Homebrew is missing, install it from https://brew.sh.
3. **Clones or updates the source** without discarding local changes, then runs
   `npm ci` and the bridge build.
4. **Rewrites stale home paths** (`/Users/<old-name>` to `$HOME`) in
   `~/.agentic-wear/config.json` (e.g. `defaultCwd`) and `.env.local`. It keeps a
   timestamped backup of each file it changes. It auto-detects the old home
   from the plist/config; set `AGENTIC_WEAR_OLD_HOME=/Users/bughunter` to force it.
5. **Checks secrets** without printing them (see below).
6. **Checks the pairing**: the config plus the Keychain items
   `<pairId>:ecdh-private-key` and `<pairId>:relay-credential` in service
   `io.github.sirbughunter.agenticwear.bridge`. If they survived the upgrade,
   the watch needs nothing. If not, and you run the script in a terminal with
   the relay URL and bootstrap secret available, it starts a new pairing and
   shows an 8‑character code.
7. **Installs the LaunchAgent** with `bridge/dist/cli.js service install`. The
   agent has `RunAtLoad` (starts at login), `KeepAlive` (restarts after a crash,
   throttled to every 10 s), absolute paths for the current user, a `PATH` that
   includes Node/Codex, and logs in `~/Library/Logs/AgenticWear/`.
8. **Runs `doctor`** and prints what to do on the watch.

## Secrets and where they come from

Nothing secret is ever written to tracked files. `.env.local` is git‑ignored and the script sets it to mode `600`.

| Secret | Needed for | Where the script looks |
| --- | --- | --- |
| `OPENAI_API_KEY` | `agentic-wear start` (refuses to start without it) | `.env.local`, then the `OPENAI_API_KEY` env var, then Keychain account `openai-api-key` in service `io.github.sirbughunter.agenticwear.bridge` |
| Relay bootstrap secret (`PAIRING_BOOTSTRAP_SECRET` on the relay) | Only for **re‑pairing** | `AGENTIC_WEAR_BOOTSTRAP_SECRET` env var, or Keychain account `relay-bootstrap-v1` |
| Relay credential and ECDH private key | Running the bridge | Keychain, created by pairing. These cannot be recreated, only re‑paired |

To store the OpenAI key in Keychain once (it prompts for the value, so it stays out of shell history):

```sh
security add-generic-password -U -s io.github.sirbughunter.agenticwear.bridge -a openai-api-key -w
```

Non‑secret settings: `AGENTIC_WEAR_RELAY_URL` (only for re‑pairing; otherwise
read from `config.json`) and `AGENTIC_WEAR_DEFAULT_CWD` (the default project for
watch‑started tasks when re‑pairing, which defaults to `$HOME`).

## Inventory: what the watch connection depends on

| Piece | Location | Survives a username change? |
| --- | --- | --- |
| Bridge source/build | `<install dir>/bridge/dist/cli.js` | Yes if the home folder was migrated; the script rebuilds anyway |
| LaunchAgent | `~/Library/LaunchAgents/io.github.sirbughunter.agenticwear.bridge.plist` | **No.** It contains absolute `/Users/bughunter/…` paths. The script regenerates it |
| Bridge config | `~/.agentic-wear/config.json` (`relayUrl`, `pairId`, public keys, `defaultCwd`) | Yes, but `defaultCwd` is stale. The script rewrites it |
| Replay ledger | `~/.agentic-wear/config.json.replay-v2/` | Yes, and it needs no changes |
| Env file | `<install dir>/.env.local` | Yes if migrated |
| Pairing secrets | login Keychain, service `io.github.sirbughunter.agenticwear.bridge` | Only if the login keychain moved with the account |
| Codex App Server | `codex` CLI plus the socket at `~/.codex/app-server-control/app-server-control.sock` | The CLI may need reinstalling; the bridge starts the daemon itself |
| Cloud relay | Cloudflare Worker (`relay/`), secrets via `wrangler secret` | Unaffected |
| Watch pairing | watch app storage (relay URL, pair id, credential) | Unaffected |
| Chrome Receiver / Dot target / native host (cloud voice) | Mac ZIP package and Chrome profile. **Not in this source tree** | Re-enable in Chrome. Re-register the native host from the Mac 0.3.17 ZIP (`node scripts/register-receiver-host.mjs --apply`) if Chrome reports it missing |

**Ports and network.** The bridge opens **no listening ports**. It makes
outbound HTTPS/WSS (443) connections to the relay and uses a local Unix socket
to Codex. No inbound firewall rule is needed. There are no TLS client
certificates. Pairing is mutual authentication over an 8‑character code, with
the resulting keys stored in Keychain.

## Watch side

- **Pairing survived** (the script says "Existing pairing found"): nothing to
  do. Open Agentic Wear; the chat list refreshes once the bridge reconnects.
- **Pairing lost**: on the watch, open **Settings → Disconnect bridge**, then
  enter the code the script printed and your relay URL. The script waits
  until both sides have authenticated.

## Troubleshooting (macOS betas)

**Check the service first**

```sh
launchctl print gui/$(id -u)/io.github.sirbughunter.agenticwear.bridge | head -30
tail -n 50 ~/Library/Logs/AgenticWear/bridge.err.log
node <install dir>/bridge/dist/cli.js doctor
```

**`Bootstrap failed: 5: Input/output error`.** This is a race between
`bootout` and `bootstrap`; the installer now retries. If it persists, run
`launchctl bootout gui/$(id -u)/io.github.sirbughunter.agenticwear.bridge`,
wait a few seconds, then re-run the script.

**Login item disabled.** macOS 13+ lists LaunchAgents under **System
Settings → General → Login Items & Extensions → Allow in the Background**.
Betas sometimes reset this. Make sure `node` (or the Agentic Wear entry) is
allowed, then re-run the script.

**Local Network permission.** macOS 15+ asks before an app reaches devices on
the LAN. The bridge only connects to the internet relay and a Unix socket, so
normally no prompt appears. If you use a relay on your LAN (for example
`wrangler dev` on another machine), allow `node` under **System Settings →
Privacy & Security → Local Network**. Betas sometimes lose this toggle or
never show the prompt for background agents. Run
`node bridge/dist/cli.js start` once in Terminal to trigger the prompt, then
re-run the script.

**Firewall prompt "Do you want node to accept incoming connections?"** The
bridge does not need incoming connections. Choosing *Deny* is fine. If the
stealth/firewall setting blocks outbound traffic (third‑party firewalls such as
Little Snitch or LuLu), allow `node` outbound to your relay host on 443.

**Keychain prompts or `The bridge secret in Keychain is invalid`.** After a
username change the login keychain may be locked or have a different password.
Open Keychain Access, unlock `login`, and look for items in service
`io.github.sirbughunter.agenticwear.bridge`. If they are gone, re‑pair (see
above). The `expect` tool (`/usr/bin/expect`) must exist to write items. Some
betas omit it; fix that with `brew install expect`.

**`Could not start the managed Codex App Server`.** Run `codex --version` in
Terminal. Reinstall with `npm i -g @openai/codex` and re-run the script so the
LaunchAgent picks up the new absolute path. Sign in with `codex login` if
needed.

**`env: node: No such file or directory` in `bridge.err.log`.** This came from
the old LaunchAgent, which had no `PATH`. Re-run the script; the regenerated
plist puts the Node and Codex directories on `PATH`.

**Bridge shows connected but the watch never updates after sleep/Wi‑Fi
change.** Older bridges could keep a dead (half‑open) WebSocket forever. The
bridge now reconnects when the relay stops answering heartbeats for 75 s.
Update and re-run the script.

**Stale `/Users/bughunter` paths elsewhere.** Search with
`grep -rl /Users/bughunter ~/Library/LaunchAgents ~/.agentic-wear <install dir>/.env.local`
and re-run with `AGENTIC_WEAR_OLD_HOME=/Users/bughunter`.

**Undo.** Run `node bridge/dist/cli.js service uninstall`. It removes only the
LaunchAgent; pairing and Keychain data are kept.
