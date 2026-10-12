# Native Dot voice on the Watch

Private candidate 97 is prepared from build 96 (`9925108`). The native Lumen call
has accepted creation and attachment through the signed-in Chrome page. Its
voice reached the experimental Mac relay, and the user confirmed that the
duplicate speaker playback was corrected. Watch microphone input and physical
Watch acceptance are still pending. The Watch/bridge/browser media delegation
code is implemented and the signed candidate is built; activation and private
publication are tracked separately from physical acceptance.

## Intended route

Reuse the Watch's existing native WebRTC microphone, speaker, echo cancellation,
foreground service and audio focus. Chrome continues to own the account login,
Dot selection, call creation and call attachment. Pass the Watch's complete SDP
offer through the native browser call's standard WebRTC interface and return its
answer over Agentic Wear's existing encrypted signaling channel. Media then runs
between the Watch and the native voice endpoint, avoiding a second media hop on
the Mac. Account credentials stay in Chrome.

The adapter must mirror peer/data-channel state to the native browser client,
hold Watch input until both media connection and native call attachment succeed,
and scope cancellation, mute and cleanup to the current call. It must refuse to
replace somebody else's active browser call. Receiver disconnection, stale
commands, expiry and stop during startup must release the owned call. The
browser's own call sounds and placeholder media must not produce duplicate
playback or open the Mac microphone.

## Validation and delivery

Completed: bridge checks, 579 bridge tests, 26 browser-script tests, the additional
authenticated native-host exchange regression, 44 relay tests, Watch unit tests,
native Kotlin compilation, signed minified release assembly and release lint.
The exact candidate keeps signer `bc70f367781d453b8dd22eb4daf5b735c291656a0d64137f974094aefdb6cda8`,
production package identity, Firebase push configuration, ARM32 and ARM64.
Its SHA-256 is `5e2c09c3b42c70b417910c6c8265069d663dbfa5267bde7a9d9510e9ec73c29f`.
A local check using real Chrome WebRTC, AudioContext and AudioWorklet interfaces
passed without a browser user gesture and with zero physical microphone requests.
That check did not open a Lumen call or establish physical Watch media.

The browser receiver keeps call cancellation separate from disposal: a native
host reconnect must not remove capability listeners. Disposal is idempotent and
cannot reschedule the retired content observer. A cancelled startup cannot
release a newer call. These paths have focused browser regressions; adapter
0.3.2 also announces availability when its main-world hook finishes loading.

1. Verify the SDP delegation and native-client lifecycle with focused browser
   adapter tests and a synthetic endpoint. Never record personal audio.
2. Integrate the authenticated browser receiver, bridge capabilities and Watch
   transport state. Preserve local-task voice, cloud text, Phonon, pairing,
   signing, push configuration and the official desktop updater.
3. Run the relevant bridge/relay checks, Watch tests and signed minified build
   checks. Use a version code greater than 96, retain ARM32 and ARM64, and verify
   the installed release signer and private updater manifest.
4. Deploy the reviewed receiver/bridge changes and stage the APK on the existing
   authenticated pair-scoped private update route. Public Alpha/Stable delivery
   remains outside this change. The older public Alpha wording in AGENTS.md is
   inconsistent with the private live-voice delivery documentation and deployed
   builds; preserve the private route used by build 96.
5. After the user installs the private update, verify microphone input, one
   speaker stream, barge-in, mute/end, captions, wrist-down continuation and
   measured response latency on the actual Pixel Watch 3. Until then, report the
   candidate as physically unverified.

The existing native transport requires Watch Wi-Fi or cellular connectivity.
Bluetooth phone-proxy voice and network handover require physical acceptance;
text connectivity does not establish WebRTC media reachability. Keep the Mac's
VPN on and leave split tunneling unchanged. A Mac media relay remains an option
if direct media proves unsuitable.

The user is asleep during implementation. Do not start a physical microphone
test or make audible test calls while working unattended.
