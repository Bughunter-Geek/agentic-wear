#!/bin/bash
# Agentic Wear — reinstate a self-hosted Mac setup (see docs/mac-reinstatement.md).
#   AW_ZROK_NAME=<reserved name> bash scripts/mac-reinstate/reinstate.sh [--migrate-from OLD_HOME] [--pair]
# Idempotent. Never prints secrets. Keeps anything it replaces as *.before-reinstate-<time>.
set -euo pipefail

OLD=""; PAIR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --migrate-from) OLD="${2:?}"; shift 2;;
    --pair) PAIR=1; shift;;
    *) echo "Unknown option $1"; exit 2;;
  esac
done

# ---- layout: override any of these with environment variables -------------
# Paths are relative to $HOME so the same layout works on an old and a new account.
: "${AW_ZROK_NAME:?Set AW_ZROK_NAME to your reserved zrok name (e.g. agentic-wear-xxxxxxxx)}"
BRIDGE_REL="${AW_BRIDGE_REL:-Library/Application Support/Agentic Wear/bridge}"
RELAY_REL="${AW_RELAY_REL:-Library/Application Support/Agentic Wear/self-hosted-relay}"
ZROK_REL="${AW_ZROK_REL:-.local/bin}"
STATE_REL="${AW_STATE_REL:-Library/Application Support/Agentic Wear/relay-state}"
ENVF="${AW_ENV_FILE:-$HOME/Library/Application Support/Agentic Wear/.env.local}"
ZNAME="$AW_ZROK_NAME"
ORIGIN="https://$ZNAME.shares.zrok.io"
UA="OpenAI File Downloader, XaiImageApiFetch/1.0"
NODE_HOME="$HOME/.local/node"; NODE="$NODE_HOME/bin/node"
CODEX="${AW_CODEX_PATH:-/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex}"
LA="$HOME/Library/LaunchAgents"; LOGS="$HOME/.agentic-wear/relay-logs"; D="gui/$(id -u)"
BRIDGE="$HOME/$BRIDGE_REL"; RELAY="$HOME/$RELAY_REL"; ZROK="$HOME/$ZROK_REL/zrok2"; STATE="$HOME/$STATE_REL"
TS="$(date +%s)"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(uname -s)" = Darwin ] || die "Run on the Mac."

# ---------------------------------------------------------------- Node
step "Node.js 22 in ~/.local/node"
export PATH="$NODE_HOME/bin:$PATH"
if ! { [ -x "$NODE" ] && [ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -ge 22 ]; }; then
  case "$(uname -m)" in arm64) A=arm64;; x86_64) A=x64;; *) die "CPU $(uname -m)";; esac
  B="https://nodejs.org/dist/latest-v22.x"; L="$(curl -fsSL "$B/SHASUMS256.txt" | grep "darwin-$A.tar.gz\$" | head -1)"
  F="${L##* }"; T="$(mktemp -d)"; curl -fL --progress-bar -o "$T/$F" "$B/$F"
  [ "$(shasum -a 256 "$T/$F" | cut -d' ' -f1)" = "${L%% *}" ] || die "Node checksum mismatch"
  rm -rf "$NODE_HOME"; mkdir -p "$NODE_HOME"; tar -xzf "$T/$F" -C "$NODE_HOME" --strip-components 1; rm -rf "$T"
  for rc in "$HOME/.zprofile" "$HOME/.bash_profile"; do grep -qs '.local/node/bin' "$rc" || echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> "$rc"; done
fi
ok "$("$NODE" -v)"

# ---------------------------------------------------------------- migrate
if [ -n "$OLD" ]; then
  step "Copying from old account: $OLD"
  for rel in "$BRIDGE_REL" "$RELAY_REL" "$ZROK_REL" "$STATE_REL" ".zrok2"; do
    sudo test -e "$OLD/$rel" || { warn "missing in old account: $rel"; continue; }
    [ -e "$HOME/$rel" ] && mv "$HOME/$rel" "$HOME/$rel.before-reinstate-$TS"
    mkdir -p "$(dirname "$HOME/$rel")"; sudo ditto "$OLD/$rel" "$HOME/$rel"; sudo chown -R "$(id -un):staff" "$HOME/$rel"
    ok "~/$rel"
  done
  xattr -dr com.apple.quarantine "$HOME/$ZROK_REL" "$RELAY" "$BRIDGE" 2>/dev/null || true
  chmod 700 "$HOME/.zrok2" "$STATE" 2>/dev/null || true
  # Bridge settings live next to (not inside) the bridge directory, so copy them separately.
  case "$ENVF" in
    "$HOME"/*)
      ENV_REL="${ENVF#"$HOME"/}"
      if [ -f "$ENVF" ]; then
        ok "keeping existing ~/$ENV_REL"
      elif sudo test -f "$OLD/$ENV_REL"; then
        mkdir -p "$(dirname "$ENVF")"
        (umask 077; sudo cat "$OLD/$ENV_REL" > "$ENVF")
        ok "~/$ENV_REL"
      else
        warn "missing in old account: $ENV_REL (set AW_ENV_FILE or create it before continuing)"
      fi;;
    *) warn "AW_ENV_FILE is outside \$HOME; not migrated";;
  esac
fi
for p in "$BRIDGE/bridge/dist/cli.js" "$RELAY/server.mjs" "$ZROK" "$STATE"; do [ -e "$p" ] || die "Missing $p (use --migrate-from)"; done
[ -f "$ENVF" ] || die "Missing $ENVF (bridge settings: OPENAI_API_KEY, AGENTIC_WEAR_TRANSCRIPTION_PROVIDER=openai, …)"
chmod 600 "$ENVF"

# ---------------------------------------------------------------- Codex
step "Codex (ChatGPT.app bundled CLI)"
[ -x "$CODEX" ] || CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
[ -x "$CODEX" ] || die "ChatGPT.app with bundled Codex not found"
"$CODEX" login status >/dev/null 2>&1 && ok "signed in" || warn "Codex not signed in: run \"$CODEX\" login"
CFG="$HOME/.codex/config.toml"; mkdir -p "$HOME/.codex"; touch "$CFG"
if ! grep -q '^experimental_realtime_webrtc_call_base_url' "$CFG"; then
  cp "$CFG" "$CFG.before-reinstate-$TS"
  { echo 'experimental_realtime_webrtc_call_base_url = "https://chatgpt.com/backend-api/codex"'; cat "$CFG.before-reinstate-$TS"; } > "$CFG"
  ok "added realtime base URL"
fi
grep -q '127.0.0.1:17841' "$CFG" && warn "config.toml points openai_base_url at the dead local proxy 127.0.0.1:17841 — remove it"
"$CODEX" app-server daemon start >/dev/null 2>&1 || true
[ -S "$HOME/.codex/app-server-control/app-server-control.sock" ] && ok "app-server daemon socket present" || warn "daemon socket missing"

# ---------------------------------------------------------------- bridge schema fix
step "Bridge voice-list schema (accept v3)"
"$NODE" -e '
  const fs=require("fs"),p=process.argv[1];let s=fs.readFileSync(p,"utf8");
  const i=s.indexOf("realtimeVoiceListResponseSchema");const j=s.indexOf("}).strict(),",i);
  if(i>=0&&j>i&&j-i<600&&!s.slice(i,j).includes("passthrough")){fs.copyFileSync(p,p+".bak");s=s.slice(0,j)+"}).passthrough(),"+s.slice(j+12);fs.writeFileSync(p,s);console.log("  patched");}
  else console.log("  already fine");' "$BRIDGE/bridge/dist/schemas.js"

# ---------------------------------------------------------------- pairing state
# The bridge cannot start without ~/.agentic-wear/config.json and its Keychain
# credentials. Neither is migrated (the keys live in the old account's Keychain),
# so a fresh account must pair. Check before any running service is replaced.
pairing_ok() {
  local cfg="$HOME/.agentic-wear/config.json" id
  [ -f "$cfg" ] || return 1
  id="$("$NODE" -e 'const c=require(process.argv[1]);if(!c.pairId||!c.watchPublicKey)process.exit(1);process.stdout.write(c.pairId)' "$cfg" 2>/dev/null)" || return 1
  security find-generic-password -s io.github.sirbughunter.agenticwear.bridge -a "$id:ecdh-private-key" >/dev/null 2>&1 &&
  security find-generic-password -s io.github.sirbughunter.agenticwear.bridge -a "$id:relay-credential" >/dev/null 2>&1
}
if [ "$PAIR" = 0 ]; then
  pairing_ok && ok "existing pairing found" ||
    die "No usable pairing on this account (config.json or its Keychain credentials are missing). Re-run with --pair."
fi

# ---------------------------------------------------------------- LaunchAgents
mkdir -p "$LA" "$LOGS" "$HOME/.agentic-wear"; chmod 700 "$HOME/.agentic-wear" "$LOGS"
# sed, not ${s//…}: bash ≥5.2 treats & in a replacement as the match (patsub_replacement).
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"; }
plist() { # label workdir stdout stderr env-pairs(k=v;…) -- args…
  local label="$1" wd="$2" out="$3" err="$4" envs="$5"; shift 6
  { echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo "<plist version=\"1.0\"><dict><key>Label</key><string>$(xml "$label")</string><key>ProgramArguments</key><array>"
    for a in "$@"; do printf '<string>%s</string>\n' "$(xml "$a")"; done
    echo "</array><key>WorkingDirectory</key><string>$(xml "$wd")</string><key>EnvironmentVariables</key><dict>"
    echo "<key>HOME</key><string>$(xml "$HOME")</string><key>PATH</key><string>$(xml "$NODE_HOME/bin:/usr/bin:/bin:/usr/sbin:/sbin")</string>"
    local IFS=';'; for kv in $envs; do [ -n "$kv" ] && printf '<key>%s</key><string>%s</string>\n' "$(xml "${kv%%=*}")" "$(xml "${kv#*=}")"; done
    echo "</dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>"
    echo "<key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>$(xml "$out")</string><key>StandardErrorPath</key><string>$(xml "$err")</string></dict></plist>"
  } > "$LA/$label.plist"; chmod 600 "$LA/$label.plist"
  launchctl bootout "$D/$label" 2>/dev/null || true
  launchctl bootstrap "$D" "$LA/$label.plist"
}

step "Services"
launchctl bootout "$D/io.agentic-wear.reserved-relay" 2>/dev/null || true
[ -f "$LA/io.agentic-wear.reserved-relay.plist" ] && mv "$LA/io.agentic-wear.reserved-relay.plist" "$LA/io.agentic-wear.reserved-relay.plist.disabled"

plist io.agentic-wear.relay-server "$RELAY" "$LOGS/io.agentic-wear.relay-server.out.log" "$LOGS/io.agentic-wear.relay-server.err.log" "" -- \
  "$NODE" "$RELAY/server.mjs" start "--state=$STATE" --port=8789
for i in $(seq 1 20); do curl -fsS -m 3 http://127.0.0.1:8789/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS -m 3 http://127.0.0.1:8789/health >/dev/null || { tail -n 20 "$LOGS"/io.agentic-wear.relay-server.*.log; die "local relay not answering"; }
ok "relay on 127.0.0.1:8789"

plist io.agentic-wear.relay-zrok "$HOME" "$LOGS/io.agentic-wear.relay-zrok.out.log" "$LOGS/io.agentic-wear.relay-zrok.err.log" "" -- \
  "$ZROK" share public http://127.0.0.1:8789 -n "public:$ZNAME" --headless --force-local
up=0; for i in $(seq 1 30); do case "$(curl -sS -m 5 -A "$UA" "$ORIGIN/health" 2>/dev/null || true)" in *'"ok":true'*) up=1; break;; esac; sleep 3; done
if [ "$up" = 1 ]; then ok "tunnel $ORIGIN"; else
  warn "tunnel not up. Last zrok log:"; tail -n 5 "$LOGS/io.agentic-wear.relay-zrok.err.log" || true
  echo "   'busy'    → VPN  blocks zrok: split-tunnel zrok2 or disconnect the VPN"
  echo "   'in use by share X' → \"$ZROK\" delete share X"
  echo "   both persist → T=\$(node -e '…environment.json token…'); zrok2 disable; zrok2 enable \"\$T\"  (docs/mac-reinstatement.md, zrok section)"
fi

BENV="AGENTIC_WEAR_ENV_FILE=$ENVF;AGENTIC_WEAR_CODEX_PATH=$CODEX;AGENTIC_WEAR_NATIVE_CLOUD_TEXT_RECOVERY=1;AGENTIC_WEAR_NATIVE_APP_APPROVALS=1;AGENTIC_WEAR_NATIVE_CLOUD_VOICE=0"

# ---------------------------------------------------------------- pairing
if [ "$PAIR" = 1 ]; then
  [ "$up" = 1 ] || die "Cannot pair while the tunnel is down."
  step "Pairing (watch: Settings → Disconnect bridge, then enter the code; relay URL $ORIGIN)"
  SECRET="$("$NODE" - "$STATE" <<'JS'
const fs=require("fs"),path=require("path");
(function walk(d,n){ if(n>3) return; for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name);
  if(e.isDirectory()) walk(p,n+1); else if(e.name.endsWith(".json")&&fs.statSync(p).size<1e6){ try{ const s=JSON.parse(fs.readFileSync(p,"utf8"))?.bindings?.PAIRING_BOOTSTRAP_SECRET;
  if(typeof s==="string"&&s.length>=20){ process.stdout.write(s); process.exit(0);} }catch{} } } })(process.argv[2],0); process.exit(1);
JS
)" || die "bootstrap secret not found in relay-state"
  launchctl bootout "$D/io.github.sirbughunter.agenticwear.bridge" 2>/dev/null || true
  ( cd "$BRIDGE" && AGENTIC_WEAR_ENV_FILE="$ENVF" AGENTIC_WEAR_CODEX_PATH="$CODEX" AGENTIC_WEAR_BOOTSTRAP_SECRET="$SECRET" \
    "$NODE" bridge/dist/cli.js pair --relay "$ORIGIN" --cwd "$HOME" --replace )
  unset SECRET
  warn "Re-run scripts/mac-reinstate/setup-dot-target.mjs \"<Dot URL>\" \"<Dot name>\" — the Dot config is bound to the pairing."
fi

plist io.github.sirbughunter.agenticwear.bridge "$BRIDGE" "$HOME/.agentic-wear/bridge.stdout.log" "$HOME/.agentic-wear/bridge.stderr.log" "$BENV" -- \
  "$NODE" "$BRIDGE/bridge/dist/cli.js" start
sleep 8
grep -q 'relay.socket.connected' <(tail -n 30 "$HOME/.agentic-wear/bridge.stdout.log" 2>/dev/null) && ok "bridge connected to relay" \
  || { warn "bridge not connected yet:"; tail -n 8 "$HOME/.agentic-wear/bridge.stderr.log" 2>/dev/null || true; }

# ---------------------------------------------------------------- Chrome
step "Chrome receiver"
if [ -d "$HOME/Library/Application Support/Google/Chrome" ] && [ -f "$BRIDGE/scripts/register-receiver-host.mjs" ]; then
  (cd "$BRIDGE" && "$NODE" scripts/register-receiver-host.mjs --apply) && ok "native host registered" || warn "native host registration refused"
else warn "Open Chrome once, then: cd \"$BRIDGE\" && node scripts/register-receiver-host.mjs --apply"; fi
echo "  Extension: chrome://extensions → Load unpacked (once). If Dot connect fails: node scripts/mac-reinstate/patch-dot-url.mjs <extension dir>"

echo; echo "Done. On the watch: tap Retry. Health checks: docs/mac-reinstatement.md."
