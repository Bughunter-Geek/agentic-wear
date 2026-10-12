# Native Dot voice on the Watch

Private candidate 97 is prepared from build 96 (`9925108`). The native Lumen call
has accepted creation and attachment through the signed-in Chrome page. Its
voice reached the experimental Mac relay, and the user confirmed that the
duplicate speaker playback was corrected. On 2026-10-12 the user confirmed native
Lumen microphone and speaker operation on the actual Watch, with superb audio
quality after connection. After adapter 0.3.4 restored bridge startup, the next
call connected on its first attempt; the user measured 24 seconds to connect.
Interruption, mobile-network acceptance and conversational latency remain
unverified.
The Watch/bridge/browser media delegation
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

Completed: bridge checks, 583 bridge tests, 37 browser-script tests, the additional
authenticated native-host exchange regression, 44 relay tests, Watch unit tests,
native Kotlin compilation, signed minified release assembly and release lint.
The exact candidate keeps signer `bc70f367781d453b8dd22eb4daf5b735c291656a0d64137f974094aefdb6cda8`,
production package identity, Firebase push configuration, ARM32 and ARM64.
Its SHA-256 is `5e2c09c3b42c70b417910c6c8265069d663dbfa5267bde7a9d9510e9ec73c29f`.
A local check using real Chrome WebRTC, AudioContext and AudioWorklet interfaces
passed without a browser user gesture and with zero physical microphone requests.
That synthetic check did not open a Lumen call or establish physical Watch media;
the later physical confirmation came from the user's real Watch call.

The browser receiver keeps call cancellation separate from disposal: a native
host reconnect must not remove capability listeners. Disposal is idempotent and
cannot reschedule the retired content observer. A cancelled startup cannot
release a newer call. These paths have focused browser regressions; adapter
0.3.2 also announces availability when its main-world hook finishes loading.

Adapter 0.3.3 gives native voice events a separate bounded acknowledgement lane,
so a slow terminal notification cannot hold up call setup. Authentication and
frame admission remain ordered; voice events preserve their own order and are
discarded on disconnection. The congestion regression blocks a notification,
proves that voice proceeds, and then verifies both lanes' acknowledgements.
Numeric browser setup timings and bridge delivery timings distinguish capture,
peer creation, native call creation/attachment and relay delivery. They contain
no audio, SDP, account headers or response bodies. This is a bridge/receiver
update; the installed signed Watch build 97 is unchanged.

The first 0.3.3 restart exposed a separate startup dependency: the CLI waited
for Phonon preparation before constructing the bridge, and the bridge waited
for the local editor before opening its relay. A Core ML warmup remained pending
for over 14 minutes. In 0.3.4, ASR and editor preparation remain sequential but
run alongside network startup. Their failures are logged; transcription still
waits for actual backend readiness. The browser status now reports
`bridgeConnected` only after an authenticated local-stream acknowledgement, so
a readable Lumen page alone can no longer appear to prove bridge readiness.

## Call-start latency

The first successful 0.3.4 call produced these measured durations:

| Stage | Duration |
| --- | ---: |
| Watch complete SDP offer, from Watch startup | 1.144 s |
| Browser call creation fetch | 16.153 s |
| Browser attachment fetch | 3.223 s |
| Relay acceptance of the answer | 0.722 s |
| Relay acceptance of readiness | 0.960 s |
| Watch media connection, after receiving the answer | 0.319 s |

Some stages overlap; adding these rows does not give end-to-end latency. The
user's 24-second measurement remains the physical startup baseline. The older
Mac media prototype also measured native creation at 8.864 and 13.129 seconds,
so the main wait is not unique to delegated Watch media. Fetch duration alone
does not distinguish browser scheduling, network RTT and upstream service work.

Adapter 0.3.5 adds a resource observer restricted to the owned call's exact
create/attach requests. It emits bounded numeric DNS, connection, TLS, queue,
response-wait and download durations, plus an optional numeric upstream duration
when the response supplies it. A response wait includes network time; a missing
duration is unknown, not zero. TLS is included in the connection duration.
URLs, IDs, headers, descriptions, request bodies and audio are never emitted.
Diagnostics cannot activate a call, open the microphone or issue extra requests;
ending a call disconnects its observer. This diagnostic update does not yet
establish a latency reduction. It was activated after the user's call ended.

The subsequent 0.3.5 test was measured by the user with an iPhone stopwatch at
21.5 seconds. Its creation response wait was 15.134 seconds and attachment
response wait was 3.406 seconds. Browser queueing was 1–2 ms, with reused
connections and no DNS/connect/TLS setup. The Watch prepared its offer in
1.186 seconds and media connected 0.301 seconds after the answer. These traces
locate the dominant wait after dispatch; they do not separate network RTT from
upstream service work. The change from 24 to 21.5 seconds is not evidence of
an optimization by the diagnostic observer.

The current native browser source exposes `instant_connect: true` for Dot voice
preparation. Evidence: the `allocate` and `prepareForCall` methods in the public
[native allocation bundle](https://chatgpt.com/cdn/assets/155568.f4345aafa0.js),
inspected on 2026-10-12. Adapter 0.3.6 requests this allocation mode during an
explicit Watch call start; it does not allocate idle/background calls. The
native authentication, SDP, root-thread validation and attachment flow remain
in the native client. Watch input still waits for media and successful attachment.

The adapter returns to the original request only for HTTP 409 with no allocation
Location and one of the native client's five exact preparation-denial details.
Unknown conflicts, rate limits, server/network failures and malformed or oversized
responses remain errors and cannot trigger another allocation. Cancellation
before allocation or during denial inspection prevents a later request.
Request bodies and authentication remain in Chrome; each HTTP attempt reports
only fixed allocation-mode/status metadata and durations. Local regressions
cover these boundaries. Actual startup benefit still requires a Watch test.

Use the next actual Watch call to separate those waits before choosing an
optimization. Keep the existing parallel network/offer/capability setup and
native attachment gate. Do not allocate hidden calls, reuse expired SDP, release
input before attachment or change VPN routing to improve a displayed number.

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

Never start physical microphone or audible native-call tests unattended. During
an active user call, defer receiver reloads and bridge restarts until it ends.
