# Desktop cloud receiving

This optional receiver adds cloud chat history and completion previews to the
build 84 bridge. It requires a desktop integration; changing the bridge alone
does not provide cloud access. Watch-originated cloud prompts, voice, feedback
and approvals are outside this receiver. Existing local chat routes remain.

## Data path

The desktop adapter attaches to the existing `durable` connection through the
connection registry. It uses only shared `readThread`, bounded
`listThreadTurns`, connection/account changes and native notifications. It
does not obtain account tokens or expose arbitrary App Server RPC.

An explicit allowlist selects up to four cloud chats. A private Unix socket
requires a random local capability and a hash of the current Watch pairing.
Validated snapshots and terminal events travel through the existing bridge
encryption, relay and high-priority notification path. No new cloud service or
Watch APK is required for initial receiving.

Notifications are the fast path. A two-second reconciliation interval covers
missing events, with one outstanding read per chat, five-second cancellation,
and error backoff. The baseline suppresses historical alerts. Stable event IDs,
local acknowledgments, bounded queues, Watch deduplication and text-free bridge
receipts handle retries. Snapshot updates coalesce for 150 ms. Missing final
text triggers an immediate bounded history read; after 2.5 seconds the adapter
may send a truthful reply-ready alert instead of claiming to have a preview.

Account changes invalidate in-flight reads, caches and queued messages. A new
Watch pairing fails closed. The receiver takes precedence over legacy cloud
controller snapshots and blocks old queued sends for its selected chats.

## Building and staging

```sh
npm --prefix bridge run check
npm --prefix bridge run build
npm --prefix bridge test
npm --prefix bridge run build:desktop-cloud
python3 scripts/test-stage-desktop-cloud.py
python3 scripts/stage-desktop-cloud.py --app /Applications/ChatGPT.app \
  --module bridge/dist/desktop-cloud-adapter.cjs --out /private/tmp/desktop-cloud-staged
```

The desktop API is internal. The staging script is pinned to desktop
26.1007.30912 and exact archive/bundle hashes. It refuses an unknown build,
patches one registry hook, adds one module, regenerates ASAR integrity and
verifies every packed file. It only stages files; it never installs, signs,
launches or quits the desktop app. No auth, tool review, permission or feature
gates are changed. A supported upstream extension should replace this hook
when one is available.

Deployment status (11 October 2026): the original-identity ad-hoc build was
rejected by AMFI and rolled back. A separate Apple Development-signed
companion subsequently launched after correcting Electron's embedded ASAR
integrity digest. Its private profile is under Application Support. The native
runtime still uses the Codex Storage Key through normal macOS consent; an
isolated profile does not mean an isolated encryption key. Original Codex,
its entitlements, account data and updater remain unchanged.

The companion and bridge authenticated their private socket, but the companion
remained at its sign-in loading screen. Cloud read readiness was not reached.
The authorized test prompt has not been sent and no physical Watch latency has
been measured. The original Watch bridge is restored while alternatives are
being explored. All prepared code and pairing state are preserved.

The companion is not suitable as the main Codex app: its updater backend is
disabled and its menu still advertises a nonfunctional update action. Correct
that presentation before any companion handoff. Packaging is pinned to the
reviewed release; a future Codex build requires a fresh compatibility review.
Do not block or replace official Codex updates to preserve this experiment.

At an idle loading screen the companion's nine-process tree used 496.5 MiB
summed RSS on this 24 GiB Mac. Shared pages can be counted more than once, and
this is not a signed-in steady-state measurement. The user accepts about 1 GB
if necessary for cloud support, while preferring a smaller implementation.

A separate read-only probe used the normal local App Server authentication API
and the exact cloud origin found in the installed desktop source. Credentials
stayed in memory and were not logged or copied to disk. Metadata for the one
selected chat returned HTTP 403 with a Cloudflare browser challenge, not a JSON
API authorization result. Raw HTTP is therefore unverified; this does not prove
all native event-stream clients are impossible. No challenge bypass, identity
spoofing, or live message was attempted.

Current candidates are a small native event client, a minimal companion with
normal sign-in, and a phone notification relay if the official phone app emits
the relevant cloud alerts. Keep the full desktop companion as a fallback, and
verify one real selected cloud reply before deploying any candidate.

After deployment is authorized, configure the selected chat with
`node bridge/scripts/configure-desktop-cloud.mjs THREAD_ID TITLE`. This writes
only a mode-0600 local capability and pairing binding under the private
Agentic Wear directory. The configuration contains no ChatGPT credential.
Switch the existing bridge LaunchAgent to the prepared build, keeping its
Node path and environment. Run exactly one bridge process. Verify
`desktop.cloud.listening`, `authenticated`, and `ready` before any test prompt.

For rollback, stop the custom bridge, restore the saved application and
LaunchAgent, and restore or remove only the receiver configuration created by
this deployment. Restart the original app and bridge. Keep Watch pairing and
Watch app data intact. Never apply either direction over a different app build.

## Measuring a physical Watch

Authorize a single test prompt in an available existing cloud chat. Record the
Mac's submission timestamp immediately before calling the normal native send
tool; keep that chat's current model and effort. The receiver does not send the
test itself. Correlate `desktop.cloud.terminal_relayed` with
`watch.notify.trace` using the same event ID:

```sh
node bridge/scripts/report-cloud-latency.mjs BRIDGE_LOG EVENT_ID PROBE_JSON
```

The report distinguishes relay acceptance, Watch handling and missing Watch
evidence. Its Mac-to-Watch-to-Mac round-trip upper bound avoids cross-device
clock skew. A prompt-to-Watch round-trip below ten seconds also bounds cloud
completion-to-Watch handling, including generation and the telemetry return
trip. Native completion-to-Watch wall-clock subtraction is only an estimate.
Build 84's `posted` trace is a handling decision, not proof of OS notification
permission or rendered pixels; verify the test text on the physical Watch.

No physical Watch latency is established by unit tests or a local Unix socket
benchmark. The desktop must be running, signed in and awake, and the Watch
must have network access. FCM delivery and a sleeping desktop remain external
limits. This receiver does not yet connect Dots; those conversations require
their own verified identity and event mapping.
