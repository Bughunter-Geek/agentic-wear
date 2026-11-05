#!/usr/bin/env bash
# Agentic Wear — one-command, idempotent restore of the Mac bridge
# ("relay" on the Mac) and its LaunchAgent.
#
#   bash scripts/restore-relay-macos.sh            # from a checkout
#   bash <(curl -fsSL https://raw.githubusercontent.com/Bughunter-Geek/agentic-wear/main/scripts/restore-relay-macos.sh)
#
# Safe to re-run: every step checks current state first. It never prints or
# commits secrets. See docs/RESTORE.md for details and troubleshooting.
#
# Environment (all optional):
#   AGENTIC_WEAR_INSTALL_DIR   Checkout location. Default: detected from an old
#                              LaunchAgent (old /Users/<name>/ remapped to $HOME),
#                              else the checkout this script runs from, else
#                              $HOME/agentic-wear.
#   AGENTIC_WEAR_REPO_URL      Git URL to clone (default: GitHub upstream).
#   AGENTIC_WEAR_REF           Branch/tag to check out on a fresh clone.
#   AGENTIC_WEAR_OLD_HOME      Previous home dir to remap (auto-detected, e.g. /Users/bughunter).
#   AGENTIC_WEAR_RELAY_URL     Relay URL (only needed when re-pairing).
#   AGENTIC_WEAR_DEFAULT_CWD   Default project directory for watch-started tasks when re-pairing.
#   OPENAI_API_KEY             Needed by `agentic-wear start`; stored in .env.local (mode 600, git-ignored).
#   AGENTIC_WEAR_BOOTSTRAP_SECRET  Only needed to re-pair; may instead live in Keychain.
#   AGENTIC_WEAR_SKIP_PAIR=1   Never start interactive pairing.
#   AGENTIC_WEAR_DRY_RUN=1     Print what would happen; change nothing (also works off macOS).

set -euo pipefail

readonly KEYCHAIN_SERVICE="io.github.sirbughunter.agenticwear.bridge"
readonly LAUNCHD_LABEL="io.github.sirbughunter.agenticwear.bridge"
readonly PLIST="$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"
readonly CONFIG="${AGENTIC_WEAR_CONFIG_PATH:-$HOME/.agentic-wear/config.json}"
readonly LOG_DIR="$HOME/Library/Logs/AgenticWear"
readonly REPO_URL="${AGENTIC_WEAR_REPO_URL:-https://github.com/Bughunter-Geek/agentic-wear.git}"
DRY_RUN="${AGENTIC_WEAR_DRY_RUN:-0}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '\n\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }
run() {
  if [[ "$DRY_RUN" == 1 ]]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi
}

TODO=()
todo() { TODO+=("$*"); }

# ---------------------------------------------------------------------------
# Path remapping: /Users/<old>/x -> $HOME/x
# ---------------------------------------------------------------------------
detect_old_home() {
  if [[ -n "${AGENTIC_WEAR_OLD_HOME:-}" ]]; then printf '%s' "${AGENTIC_WEAR_OLD_HOME%/}"; return; fi
  local file candidate
  for file in "$PLIST" "$CONFIG"; do
    [[ -f "$file" ]] || continue
    candidate=$(grep -oE '/Users/[^/<"]+' "$file" | grep -vxF -e "$HOME" -e /Users/Shared | head -n1 || true)
    if [[ -n "$candidate" ]]; then printf '%s' "$candidate"; return; fi
  done
}

remap() { # remap <path> <old_home>
  local path=$1 old=$2
  if [[ -n "$old" && "$path" == "$old"/* ]]; then printf '%s' "$HOME/${path#"$old"/}"
  elif [[ -n "$old" && "$path" == "$old" ]]; then printf '%s' "$HOME"
  else printf '%s' "$path"; fi
}

plist_working_directory() {
  [[ -f "$PLIST" ]] || return 0
  if command -v plutil >/dev/null 2>&1; then
    plutil -extract WorkingDirectory raw -o - "$PLIST" 2>/dev/null || true
  else
    sed -n '/<key>WorkingDirectory<\/key>/{n;s/.*<string>\(.*\)<\/string>.*/\1/p;}' "$PLIST"
  fi
}

rewrite_old_home_in() { # rewrite_old_home_in <file> <old_home>
  local file=$1 old=$2
  [[ -n "$old" && -f "$file" ]] || return 0
  grep -qF "$old/" "$file" || grep -qF "\"$old\"" "$file" || return 0
  if [[ "$DRY_RUN" == 1 ]]; then
    printf '  [dry-run] rewrite %s -> %s in %s\n' "$old" "$HOME" "$file"
    return 0
  fi
  cp -p "$file" "$file.bak-$(date +%Y%m%d%H%M%S)"
  # Only path prefixes are touched; values are never printed.
  OLD="$old" NEW="$HOME" perl -pi -e 's/\Q$ENV{OLD}\E(?=\/|"|$)/$ENV{NEW}/g' "$file"
  ok "Rewrote $old -> \$HOME in $file (backup kept next to it)"
}

# ---------------------------------------------------------------------------
step "Preflight"
if [[ "$(uname -s)" != Darwin ]]; then
  [[ "$DRY_RUN" == 1 ]] || die "This script restores the macOS bridge; run it on the Mac (or set AGENTIC_WEAR_DRY_RUN=1 to preview)."
  warn "Not macOS: dry-run only."
fi
ok "User: $(id -un)  HOME: $HOME"

OLD_HOME=$(detect_old_home || true)
if [[ -n "$OLD_HOME" ]]; then ok "Previous home directory found in old config: $OLD_HOME (will be remapped to $HOME)"; fi

# ---------------------------------------------------------------------------
step "Install location"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)
SCRIPT_CHECKOUT=""
if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/../bridge/package.json" ]]; then
  SCRIPT_CHECKOUT=$(cd "$SCRIPT_DIR/.." && pwd)
fi
OLD_WORKDIR=$(plist_working_directory)
if [[ -n "${AGENTIC_WEAR_INSTALL_DIR:-}" ]]; then
  INSTALL_DIR="${AGENTIC_WEAR_INSTALL_DIR/#\~/$HOME}"; how="AGENTIC_WEAR_INSTALL_DIR"
elif [[ -n "$OLD_WORKDIR" ]]; then
  INSTALL_DIR=$(remap "$OLD_WORKDIR" "$OLD_HOME"); how="previous LaunchAgent ($OLD_WORKDIR)"
elif [[ -n "$SCRIPT_CHECKOUT" ]]; then
  INSTALL_DIR="$SCRIPT_CHECKOUT"; how="checkout containing this script"
else
  INSTALL_DIR="$HOME/agentic-wear"; how="default"
fi
case "$INSTALL_DIR" in /*) ;; *) die "Install directory must be absolute: $INSTALL_DIR";; esac
ok "Install dir: $INSTALL_DIR  (from $how)"

# ---------------------------------------------------------------------------
step "Dependencies"
if [[ "$(uname -s)" == Darwin ]] && ! xcode-select -p >/dev/null 2>&1; then
  run xcode-select --install || true
  die "Xcode Command Line Tools are installing (git, make). Re-run this script when that finishes."
fi
command -v git >/dev/null 2>&1 || [[ "$DRY_RUN" == 1 ]] || die "git is missing."

BREW=""
for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do [[ -x "$candidate" ]] && BREW=$candidate && break; done
[[ -n "$BREW" ]] && eval "$("$BREW" shellenv)"

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if ! command -v node >/dev/null 2>&1 || (( $(node_major) < 22 )); then
  if [[ -n "$BREW" ]]; then
    run "$BREW" install node
  elif [[ "$DRY_RUN" == 1 ]]; then
    warn "Node.js 22+ missing (would need Homebrew to install it)."
  else
    die "Node.js 22+ is required. Install Homebrew (https://brew.sh) and re-run, or install Node 22+ yourself."
  fi
fi
if command -v node >/dev/null 2>&1; then ok "Node $(node --version) at $(command -v node)"; fi

if [[ -z "${AGENTIC_WEAR_CODEX_PATH:-}" ]] && ! command -v codex >/dev/null 2>&1; then
  run npm install -g @openai/codex
fi
CODEX_PATH="${AGENTIC_WEAR_CODEX_PATH:-$(command -v codex || true)}"
if [[ -n "$CODEX_PATH" ]]; then ok "Codex CLI at $CODEX_PATH"; else
  [[ "$DRY_RUN" == 1 ]] || die "Codex CLI not found after install. Set AGENTIC_WEAR_CODEX_PATH to its absolute path."
fi
# The bridge needs `expect` (ships with macOS) to write Keychain items.
command -v expect >/dev/null 2>&1 || warn "/usr/bin/expect not found; pairing cannot store Keychain items (brew install expect)."

# ---------------------------------------------------------------------------
step "Source checkout"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  ok "Existing checkout kept as-is (local changes are never discarded)."
  if [[ -n "$(git -C "$INSTALL_DIR" status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
    warn "Checkout has uncommitted changes; not pulling."
  else
    run git -C "$INSTALL_DIR" pull --ff-only || warn "git pull failed; continuing with the current revision."
  fi
elif [[ -f "$INSTALL_DIR/bridge/package.json" ]]; then
  ok "Existing (non-git) package at $INSTALL_DIR kept as-is."
elif [[ -e "$INSTALL_DIR" && -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
  die "$INSTALL_DIR exists, is not empty and is not an Agentic Wear checkout. Move it or set AGENTIC_WEAR_INSTALL_DIR."
else
  run mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -n "${AGENTIC_WEAR_REF:-}" ]]; then
    run git clone --branch "$AGENTIC_WEAR_REF" "$REPO_URL" "$INSTALL_DIR"
  else
    run git clone "$REPO_URL" "$INSTALL_DIR"
  fi
fi

# ---------------------------------------------------------------------------
step "Build bridge"
if [[ -f "$INSTALL_DIR/bridge/package-lock.json" ]]; then
  run npm --prefix "$INSTALL_DIR/bridge" ci --no-audit --no-fund
  run npm --prefix "$INSTALL_DIR/bridge" run build
  ok "Bridge built: $INSTALL_DIR/bridge/dist/cli.js"
else
  [[ "$DRY_RUN" == 1 ]] || die "No bridge/package-lock.json in $INSTALL_DIR."
fi
CLI=(node "$INSTALL_DIR/bridge/dist/cli.js")

# ---------------------------------------------------------------------------
step "Fix stale paths from the previous user account"
ENV_FILE="$INSTALL_DIR/.env.local"
rewrite_old_home_in "$CONFIG" "$OLD_HOME"
rewrite_old_home_in "$ENV_FILE" "$OLD_HOME"
[[ -n "$OLD_HOME" ]] || ok "No paths under another /Users/<name> found."

# ---------------------------------------------------------------------------
step "Secrets (.env.local is git-ignored, mode 600; nothing is printed)"
env_has() { [[ -f "$ENV_FILE" ]] && grep -qE "^$1=." "$ENV_FILE"; }
env_set() { # env_set NAME VALUE (value via env, never echoed)
  if [[ "$DRY_RUN" == 1 ]]; then printf '  [dry-run] add %s to %s\n' "$1" "$ENV_FILE"; return; fi
  umask 077; touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  printf '%s=%s\n' "$1" "$2" >>"$ENV_FILE"
}
keychain_get() { security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$1" -w 2>/dev/null; }

if env_has OPENAI_API_KEY; then ok "OPENAI_API_KEY present in .env.local"
elif [[ -n "${OPENAI_API_KEY:-}" ]]; then env_set OPENAI_API_KEY "$OPENAI_API_KEY"; ok "OPENAI_API_KEY stored from environment"
elif [[ "$(uname -s)" == Darwin ]] && value=$(keychain_get openai-api-key) && [[ -n "$value" ]]; then
  env_set OPENAI_API_KEY "$value"; unset value; ok "OPENAI_API_KEY stored from Keychain (account openai-api-key)"
else
  warn "OPENAI_API_KEY missing — the bridge refuses to start without it."
  todo "Provide OPENAI_API_KEY: re-run with OPENAI_API_KEY=... in the environment, or store it once with: security add-generic-password -U -s $KEYCHAIN_SERVICE -a openai-api-key -w"
fi
if [[ -n "${AGENTIC_WEAR_RELAY_URL:-}" ]] && ! env_has AGENTIC_WEAR_RELAY_URL; then
  env_set AGENTIC_WEAR_RELAY_URL "$AGENTIC_WEAR_RELAY_URL"
fi
[[ -f "$ENV_FILE" && "$DRY_RUN" != 1 ]] && chmod 600 "$ENV_FILE"

# ---------------------------------------------------------------------------
step "Pairing (config + Keychain)"
PAIR_ID=""
[[ -f "$CONFIG" ]] && PAIR_ID=$(node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pairId||"")}catch{}' "$CONFIG" 2>/dev/null || true)
keychain_has() { security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$1" >/dev/null 2>&1; }
PAIRED=0
if [[ -n "$PAIR_ID" && "$(uname -s)" == Darwin ]] && keychain_has "$PAIR_ID:ecdh-private-key" && keychain_has "$PAIR_ID:relay-credential"; then
  PAIRED=1; ok "Existing pairing found (config + Keychain). The watch needs no changes."
elif [[ -n "$PAIR_ID" ]]; then
  warn "Config exists but its Keychain items are missing (new user account or new login keychain)."
else
  warn "No pairing config at $CONFIG."
fi

relay_url() {
  [[ -n "${AGENTIC_WEAR_RELAY_URL:-}" ]] && { printf '%s' "$AGENTIC_WEAR_RELAY_URL"; return; }
  [[ -f "$CONFIG" ]] && node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).relayUrl||"")}catch{}' "$CONFIG" 2>/dev/null && return
  [[ -f "$ENV_FILE" ]] && sed -n 's/^AGENTIC_WEAR_RELAY_URL=//p' "$ENV_FILE" | head -n1
}

if (( PAIRED == 0 )); then
  RELAY_URL=$(relay_url || true)
  DEFAULT_CWD="${AGENTIC_WEAR_DEFAULT_CWD:-$HOME}"
  have_bootstrap=0
  [[ -n "${AGENTIC_WEAR_BOOTSTRAP_SECRET:-}" ]] && have_bootstrap=1
  [[ "$(uname -s)" == Darwin ]] && keychain_has relay-bootstrap-v1 && have_bootstrap=1
  if [[ "${AGENTIC_WEAR_SKIP_PAIR:-0}" != 1 && -t 0 && -n "$RELAY_URL" && $have_bootstrap == 1 && "$DRY_RUN" != 1 ]]; then
    bold "Starting a new pairing. On the watch: Settings → Disconnect bridge, then enter the code below and relay URL $RELAY_URL"
    replace=(); [[ -f "$CONFIG" ]] && replace=(--replace)
    (cd "$INSTALL_DIR" && "${CLI[@]}" pair --relay "$RELAY_URL" --cwd "$DEFAULT_CWD" ${replace[@]+"${replace[@]}"})
    PAIRED=1
  else
    [[ -n "$RELAY_URL" ]] || todo "Set AGENTIC_WEAR_RELAY_URL (your relay, e.g. https://agentic-wear-relay.<account>.workers.dev)."
    (( have_bootstrap == 1 )) || todo "Provide the relay bootstrap secret: AGENTIC_WEAR_BOOTSTRAP_SECRET=... (env) or Keychain account relay-bootstrap-v1 in service $KEYCHAIN_SERVICE. It is the relay's PAIRING_BOOTSTRAP_SECRET."
    todo "Re-run this script in a terminal to pair; then on the watch: Settings → Disconnect bridge → enter the 8-character code and relay URL."
  fi
fi

# ---------------------------------------------------------------------------
step "LaunchAgent (start at login, restart on crash)"
if (( PAIRED == 1 )) && { env_has OPENAI_API_KEY || [[ "$DRY_RUN" == 1 ]]; }; then
  run mkdir -p "$LOG_DIR"
  # service install rewrites the plist with absolute paths for *this* user,
  # boots out any old job with the same label and kickstarts the new one.
  if [[ "$DRY_RUN" == 1 ]]; then
    printf '  [dry-run] (cd %s && AGENTIC_WEAR_CODEX_PATH=%s node bridge/dist/cli.js service install)\n' "$INSTALL_DIR" "$CODEX_PATH"
  else
    (cd "$INSTALL_DIR" && AGENTIC_WEAR_CODEX_PATH="$CODEX_PATH" "${CLI[@]}" service install)
    sleep 3
    (cd "$INSTALL_DIR" && "${CLI[@]}" service status) || todo "Service not loaded; see $LOG_DIR/bridge.err.log"
  fi
  ok "Logs: $LOG_DIR/bridge.log and bridge.err.log"
else
  if [[ -f "$PLIST" ]] && grep -q "/Users/" "$PLIST" && [[ -n "$OLD_HOME" ]] && grep -qF "$OLD_HOME/" "$PLIST"; then
    warn "Old LaunchAgent points at $OLD_HOME; unloading it to stop a crash loop."
    run launchctl bootout "gui/$(id -u)/$LAUNCHD_LABEL" 2>/dev/null || true
  fi
  warn "Not installing the LaunchAgent yet (needs pairing and OPENAI_API_KEY)."
  todo "Re-run this script after the items above; it will install the LaunchAgent."
fi

# ---------------------------------------------------------------------------
step "Health check"
if [[ "$DRY_RUN" != 1 ]]; then
  (cd "$INSTALL_DIR" && "${CLI[@]}" doctor) || warn "doctor reported problems (see above)."
fi

printf '\n'
bold "Watch side"
if (( PAIRED == 1 )) && [[ -z "${replace+x}" ]]; then
  echo "  Nothing to do: the watch talks to the cloud relay, not to this Mac directly."
  echo "  Open Agentic Wear on the watch; the chat list should refresh within a few seconds."
else
  echo "  Settings → Disconnect bridge, then enter the pairing code shown by this script and your relay URL."
fi
echo "  Chrome Receiver / Dot voice: re-enable 'Agentic Wear Cloud Receiver' and choose 'Connect this Dot' (see docs/RESTORE.md)."

if (( ${#TODO[@]} > 0 )); then
  printf '\n'
  bold "Still needed:"
  for item in "${TODO[@]}"; do echo "  - $item"; done
  exit 2
fi
printf '\n'
bold "Restore complete."
