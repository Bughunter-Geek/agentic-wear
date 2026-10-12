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
hold Watch input until media and the data channel are connected and the native
client actually releases its own input, and scope cancellation, mute and cleanup
to the current call. The native attachment request must still complete
successfully within the finite startup deadline; failure closes the call.
It must refuse to
replace somebody else's active browser call. Receiver disconnection, stale
commands, expiry and stop during startup must release the owned call. The
browser's own call sounds and placeholder media must not produce duplicate
playback or open the Mac microphone.

## Validation and delivery

Completed: bridge checks, 585 bridge tests, 48 browser-script tests, the additional
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
cover these boundaries.

Two subsequent native Watch calls used instant allocation successfully. Their
creation response waits were 10.029 and 10.472 seconds; relay readiness arrived
13.824 and 14.141 seconds after Mac dispatch. These are stage measurements, not
the user's end-to-end stopwatch result. One other allocation returned HTTP 500.
Several accepted attempts did not reach native capture or call creation and two
timed out on the Watch. Neither reliable first-attempt startup nor a sub-10-second
result is established for this mode. Unknown server failures still cannot trigger
a second allocation.

Adapter 0.3.7 corrects a reproducible startup-control race. The old controller
selected the last Start call button (including the profile panel), then awaited
the main-world reservation before clicking that saved element. Chrome can redraw
the button during that wait. The controller now prefers the persistent toolbar
and resolves a connected, enabled, rendered control again immediately before
clicking. A missing control or changed Dot identity releases the reservation
without clicking or allocating. Capability also requires an actionable control.
Regressions cover a profile panel, a toolbar replacement during acknowledgement,
control removal/disablement and hidden/inert/unrendered controls.

Fixed control-clicked, capture and peer checkpoints distinguish adapter dispatch
from actual native media setup without granting readiness or recording page data.
The earlier silent timeouts have not yet been causally linked to the button race;
the next physical Watch test must verify startup and reveal its last reached phase.
The bridge/native host accept the optional instant-mode timing fields from 0.3.6
as well as older receiver events, so an idle recovery cannot break signaling while
Chrome still has an earlier hook loaded. Receiver activation still requires an
idle Dot page reload to replace the existing main-world hook.

The physical 0.3.7 test did not connect. One attempt ended during capture before
a peer existed; the next never reached capture and timed out at 31.6 seconds on
the Watch. Chrome also reported HTTP 503 for a native call stop request. The
control-race fix alone therefore did not establish reliable startup.

Adapter 0.3.8 explicitly cancels the native startup through its Hang up control
before releasing the matching main-world Watch ownership token. This covers a
stop before peer creation, when closing a nonexistent media peer cannot notify
the native client. Cancellation runs synchronously; a stale token cannot click
the control of a newer call. Reentrant close callbacks are harmless, and native
control exceptions still release every owned media resource. An unclicked
reservation cannot cancel a native call. Delegated captures use placeholder
tracks, and an ended owned capture rejects during cancellation.

Previous-call cleanup requests now have a fixed startup checkpoint, and a failed
cleanup response is reported without waiting silently for capture. It propagates
the native error and never retries allocation. Fixed bridge end-reason codes
distinguish a Watch stop, native close/failure, receiver loss, lease expiry and
bridge shutdown. These diagnostics contain no page text or response bodies.
Actual first-attempt startup and the latency target remain unverified for 0.3.8.

The resumed 0.3.8 test reached native capture and peer creation within 405 ms
of Mac dispatch. Native instant creation then waited 16.847 seconds for a
response. The Watch's media connected, but the browser closed the call at
20.454 seconds. The inspected native client sets a 20-second watchdog around
allocation, attachment and media activation. A second attempt connected;
the user measured 19 seconds, with 10.601 seconds waiting for creation and
3.963 seconds waiting for attachment. The first voice query did not receive
an immediate reply; its conversational delay is not yet measured separately.

Adapter 0.3.9 aligns that exact native watchdog with the Watch's existing
30-second startup window. It matches the known native timeout callback only
while an owned Watch call has a native peer and has not become active. Personal
calls, reservations without media, other delays and unrelated callbacks retain
native timer behavior. Native errors and cancellation still propagate, and
Watch input still requires media connection and successful attachment. A
regression completes attachment at 21 seconds; a second verifies that an
uncompleted startup still times out. This is a reliability fix, not a reduction
in the measured service response wait.

Adapter 0.3.9 was activated on 2026-10-12 as an extension-only update, with a
rollback backup. Chrome showed 0.3.9 enabled, the loaded main-world watchdog
guard was verified, and the receiver reconnected to the bridge. The native host,
bridge, extension permissions, pairing configuration and private Watch build 97
remained unchanged. The user then confirmed a successful first attempt, measured
23 seconds to connect, and reported that the first spoken reply arrived right
away. The call ended from the Watch normally.

That call's instant allocation response wait was 15.921 seconds; attachment
response wait was 3.119 seconds. Browser peer setup completed 466 ms after Mac
dispatch, and relay readiness was accepted at 19.828 seconds. The Watch trace
shows the complete offer at 1.552 seconds, answer receipt at 19.143 seconds and
media connection at 19.464 seconds. Native attachment still gates usability.
These clocks have different origins and their durations must not be summed.
Creation reused its connection, with zero reported DNS/connect/TLS setup and
1 ms of queueing; the response wait includes network RTT and upstream service
work. No service-only timing was supplied.

The physical call became native-active at 19.529 seconds, so it did not exercise
the extended 20-to-30-second watchdog interval. One successful first attempt does
not establish reliability across network conditions. The sub-10-second startup
target remains unmet. The receiver already requests the native client's
instant allocation mode; allocation must finish before applying its real answer
and attaching, while attachment already runs alongside media activation. No
additional supported faster allocation path was found, so the timing evidence
does not justify changing allocation.

## Candidate to follow native activation

Receiver 0.3.10 is activated. Further inspection
of the public native client found that `D.activate` waits for both actual media
connection and the open data channel, and includes the attachment promise only
when `activateOnWebRtcConnection` is false. It then checks native identity, calls
`releaseInputAudio` and publishes its active state. The current caller enables
activation on WebRTC by default, subject to its runtime configuration.
The microphone implementation sends `{type: "release"}` to its
`codex-realtime-buffered-audio` worklet at that exact point. Source: the inspected
`lfL` module in `155568.f4345aafa0.js` and `V3`/`HzP` modules in
`731863.574ec9e40d.js`.

The candidate observes that native release only on the current call's owned
placeholder graph and known processor. Readiness also requires actual connected
Watch media, an open endpoint data channel and a dispatched attachment POST.
An unknown processor, another graph, a stopped call, a failed port message, or
media/channel state alone cannot release input. If the native client waits for
attachment, the adapter waits too. The adapter does not change the native policy.

This differs from 0.3.9's requirement to await a successful attachment HTTP
response before releasing Watch input. Attachment still runs normally; its
HTTP/network errors still propagate through native failure handling and close
the owned call. A pending attachment remains bounded by a 30-second deadline,
even when native audio has already become active. No idle calls, fabricated
transport state, Mac microphone capture or account-policy overrides are added.

All 54 browser tests and nine focused native bridge tests pass. A synthetic
evaluation of the unmodified native `activate` method confirms both configuration
paths and its media/channel requirements. The previous Watch trace suggests
potential to overlap about 3.1 seconds of attachment wait; actual startup and
first-response timing require another physical Watch test. No under-20-second
result was claimed before the physical test.

The first actual 0.3.10 Watch call worked, and the user measured approximately
20.8 seconds with noticeably better perceived responsiveness. Creation response
wait was 15.833 seconds, comparable with 0.3.9's 15.921 seconds. Attachment response
wait was longer at 3.858 seconds. Native input release occurred at browser
17.852 seconds, while attachment completed at 20.470 seconds: 2.618 seconds of
attachment wait overlapped real native activation. Relay readiness was accepted
18.061 seconds after Mac dispatch. The Watch's offer was ready at 1.093 seconds,
media connected at 18.838 seconds and its channel opened at 18.959 seconds.
Attachment succeeded with HTTP 200 and the call ended normally from the Watch.
The user did not supply an exact first-reply duration. The under-20-second target
remained unmet by that stopwatch result.

The follow-up investigation found Disable cache enabled in the Dot page's open
Chrome DevTools. Normal caching was restored and DevTools closed before a second
physical timing test. This is a browser diagnostic-state correction; Watch build
97 and receiver 0.3.10 are unchanged.

The normal-cache retest took 22–23 seconds according to the user. Chrome peer
setup improved from browser 748 ms to 81 ms, but creation response wait grew
from 15.833 to 18.064 seconds. Answer relay acknowledgement took 912 ms and
readiness acknowledgement 1.364 seconds. Native input release still preceded
successful attachment by 2.076 seconds; attachment returned HTTP 200 and the
Watch ended the call normally. No end-to-end cache gain or under-20-second
startup was established. Response waits include network time, and these samples
do not isolate upstream computation.

## Native direct-allocation comparison

Receiver 0.3.11 is activated, with physical comparison pending. It preserves the native client's original
allocation request instead of forcing `instant_connect: true`. The public `jMD`
module uses instant mode for preparation but standard mode for an unprepared
direct call (`prepareForCall` invokes `allocate` with false). Earlier instant
calls ranged from about 10 to 18 seconds of creation response wait, so the
preparation flag has not established a consistent latency advantage.

The candidate leaves the native SDP, body, headers, identity, credentials and
cancellation signal unchanged. It records the client's chosen mode for timing;
explicit native preparation requests remain instant. No response body is read
to trigger a fallback, and no second allocation is issued on a denial or error.
Native input-release readiness, real media/channel checks, attachment failure
handling and the finite deadline are unchanged from 0.3.10. All 55 browser tests
pass. This extension-only candidate needs no Watch update or bridge rebuild.
Its relative speed and the under-20-second target remain physically unverified.

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
