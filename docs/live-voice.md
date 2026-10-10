# Private live voice implementation

Status: the user-approved bridge upgrade is active, and same-signer production build 59 is staged through the existing authenticated pair-scoped private update route for 24 hours. Actual watch installation, audible duplex audio and physical Pixel Watch 3 verification remain pending. An approved silent Mac-side V3/Cove connection test passed. Public Alpha/OTA publication remains prohibited. See `../../artifacts/private-install-plan.md` for activation evidence, rollback and remaining watch steps.

## What this adds

Settings → Live conversation opens a distinct call screen. Native builds use microphone/speaker WebRTC, a data channel, and Codex App Server `thread/realtime/start` / SDP notifications. This is a conversational media transport, separate from record/transcribe. Watch↔bridge signaling uses the existing authenticated encrypted relay; microphone audio does not enter its transcription queue. No account token is sent to the watch, and no API key or separately billed public API fallback is provisioned.

The selected idle local task is resumed without changing its coding model, effort, approval policy or sandbox. The existing App Server mediated `webrtc` route is used, with explicit protocol V3, the host's realtime model, and its V1 voice catalog. This does not reproduce the newer desktop's entire client-owned V3 call orchestration. A working voice catalog proves interface availability, not voice entitlement or a successful authenticated call. The old coding-model-list entitlement gate has been removed accordingly.

The existing Phonon transcription and Qwen draft editor remain intact. “Use Phonon dictation” selects the existing Phonon engine and returns to the main app. It does not start a recording or send text automatically. Phonon can transcribe without OpenAI voice; agent responses still depend on their configured provider. No automatic paid fallback is added.

## Lifecycle

- Live voice requires finishing current dictation and pending text before connecting. The main push-to-talk action opens the ongoing live call instead of acquiring its microphone.
- A foreground microphone service owns audio focus, native echo cancellation, a bounded wake lock, and the ongoing End notification. Screen-off does not stop a call.
- Mute disables the native microphone track. End disposes media immediately, restores audio mode/focus and sends a bounded best-effort stop.
- Audio focus loss ends the call. Network disconnection gets ten seconds of grace; a failed connection ends immediately. Reconnection is explicit.
- Startup and capability negotiation have timeouts. The watch renews a 45-second bridge lease every ten seconds; missing watch heartbeats end the server call. Duplicate starts, stale stops, stop during startup, and simultaneous stop/expiry are handled.
- There is no 30-second utterance limit. An explicit two-hour resource bound ends the call. This does not diagnose the user's earlier call cutoff.
- Raw audio/server diagnostics are excluded from relay captions. Caption deltas are bounded.

## Runtime/build gate

Default builds contain the call UI, bridge protocol and a disabled native transport stub, requiring no new package download. They **cannot connect voice**. A native build opts in using `-PAGENTIC_WEAR_LIVE_VOICE_RUNTIME=true` and resolves `io.github.webrtc-sdk:android-prefixed-stripped:150.7871.01` (imports `livekit.org.webrtc`).

The Maven AAR is 14,314,150 bytes (14.31 MB / 13.65 MiB), verified using HEAD and ZIP central-directory range metadata only. Its compressed ARM64 native payload is about 3.52 MB, unpacked 7.71 MB. The complete stripped AAR is about 30.08 MB unpacked. No separate official ARM64-only Maven coordinate was found. The user approved the runtime download. Its exact 14,314,150-byte AAR was downloaded, and native adapter compilation and debug APK assembly passed. AAR SHA-256: `f6ee231f86d9f94384d0522b59f7b7cceb59bdb437b6b902f0caea667d8fbd0d`. ABI filtering can shrink the APK but does not eliminate the complete AAR download.

Offline UI-only build (transport disabled):

```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' \
  ./gradlew --offline :wear:assembleDebug --no-daemon -Dorg.gradle.workers.max=2
```

Native build: add `-PAGENTIC_WEAR_LIVE_VOICE_RUNTIME=true` to the Gradle command now that the approved dependency is cached. The latest output contains the native runtime.

The initial debug output uses a `.debug` application ID and was retained for review. Deployment preparation instead built production package `io.github.sirbughunter.agenticwear`, versionCode 59, using the existing release signer. `AGENTIC_WEAR_LIVE_VOICE_ABI=armeabi-v7a,arm64-v8a` retains both ARM watch architectures and uses standard compressed native/DEX packaging, fitting the existing 8 MiB private relay limit. Build 58 incorrectly narrowed support to ARM64 and was rejected on the watch; build 59 supersedes it. The watch's actual SDK/ABI and exact installer failure code remain unread because the existing ADB server lists no target. Explicitly ARM64-only private live builds are now rejected by configuration. See `../../artifacts/private-watch59/REPAIR.md`. Default builds retain all ABIs. The private production APK is staged; installation awaits the watch updater's existing confirmation UI.

## Your dot: verified boundary and next integration step

The user's Apple Watch examples demonstrate a third-party beta claiming actual account dot continuity, existing subscription and phone/desktop/web sync. Its public site is <https://voice.computer>. The referenced posts are:

- <https://x.com/keleftheriou/status/2105736631160602758>
- <https://x.com/keleftheriou/status/2106043574299369964>
- <https://x.com/keleftheriou/status/2105798409525592178>

Those demonstrations do not document an integration contract or authorize reproducing private authentication endpoints. No beta enrollment, contact, credential extraction, regional bypass or account changes were performed.

The current Codex desktop source distinguishes durable remote/account conversations from local App Server tasks, and can obtain realtime call metadata, create a client-owned call, and attach `existingCall` sideband transport. Resolving a local task does not prove the user's account dot identity. Agentic Wear therefore labels dot linking as unavailable rather than treating an arbitrary coding thread as the user's dot. No documented dot-specific Wear OS launch URI or phone handoff contract was verified, so none is fabricated.

A supported dot integration needs an authorized account conversation selector/identifier, a documented host mediation route for that durable conversation, and verified account-authenticated call creation/sideband attachment. If these become available, extend the existing signaling adapter to carry the authorized call answer and dot identity while keeping credentials on the host. Preserve the native watch media owner. Until then, users can access their dot through the official app; this implementation only offers the separate local task connection.

Generic public API voice is technically a different integration path, with separately billed usage and server credentials. It is not enabled as a substitute for the user's dot or subscription.

## Evidence and checks

Read-only local inspection found standalone Codex 0.159.2 and desktop app 26.930.21537 / 12776. Experimental generated bindings include WebRTC offer/answer and existing-call transport. The desktop also implements RTCPeerConnection, microphone track and `oai-events`. The configured voice base points to the ChatGPT Codex backend; no authentication files were opened.

A bounded isolated stdio App Server test successfully initialized with experimental API enabled and listed V1/V2 voices (defaults cove/marin). The process was terminated after discovery; no thread was resumed, no realtime call started and no microphone opened. The usual shared control socket was absent during inspection. The existing bridge's daemon/private-server fallback is retained.

Validation completed: initial focused bridge tests (84 tests in two files), followed by 112 tests in five files on the reconciled active bridge including Phonon/Qwen selection, bridge TypeScript/test type-check and lint, bridge compilation, default and native watch Kotlin compilation/debug APK assembly, native Android lint, runtime AAR/native APK inspection, and whitespace diff check. Audible duplex audio, interruption/barge-in, watch speaker echo, wrist-down continuation, LTE/Wi-Fi handover, actual dot continuity and physical watch acceptance are **not verified**.

This isolated checkout snapshots the active owner's uncommitted Phonon source. The live-voice patch is measured against that snapshot. Reconcile with the owner's latest changes before deploying; do not apply the snapshot wholesale over the working bridge or copy environment/pairing credentials.

References: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Codex realtime source](https://github.com/openai/codex/blob/main/codex-rs/core/src/realtime_conversation.rs), [official ChatGPT Voice](https://help.openai.com/en/articles/20001274-chatgpt-voice), [public API live voice](https://developers.openai.com/api/docs/guides/live), [WebRTC Android runtime release](https://github.com/webrtc-sdk/android/releases/tag/v150.7871.01).

## Approved runtime build evidence

The compiled native APK is 98,890,973 bytes and includes WebRTC libraries for ARM64, ARMv7, x86 and x86_64. SHA-256: `d672073a889fbe5cbb0660e7dcbe55ec16c1a03dd3d9e3238e4f0af4705f25e5`. A private copy is at `../artifacts/agentic-wear-live-voice-native-debug.apk`. Its `.debug` identity requires separate pairing; it is not an OTA replacement for the installed app. This initial debug artifact was not installed. The later approved production build and bridge upgrade are documented below.

## Approved silent connection acceptance

The user approved a single silent ephemeral-task connection, two diagnostic retries, and a final corrected attempt. These were bounded, isolated stdio Codex processes and headless Chrome profiles with generated zero-valued PCM WAV media, muted output, no physical microphone capture, no paid API fallback, and no installed-service changes. No user dot/session was selected or mutated.

The initial/default protocol and diagnostic default-protocol run were accepted by the RPC but rejected by the backend: `invalid_quicksilver_alpha_header`, requiring `OpenAI-Alpha: quicksilver=v2`. A V3/Marin attempt was rejected locally; V3 uses the **V1** catalog, not the V2 catalog. Installed desktop source independently confirms this.

The corrected V3/Cove test returned answer SDP, emitted `thread/realtime/started` with version V3, reached peer connection state `connected`, then accepted stop and emitted closed. This is actual account/backend transport acceptance on this Mac. At the instant the test ended, the data channel still reported `connecting` and zero received events. Therefore this does not establish open data-channel behavior, conversational responses, long-call stability, audible duplex audio, or watch acceptance. Those limits are intentional and must not be reported as tested.

The implementation now explicitly selects V3 while retaining V1/Cove selection. This corrects the observed legacy-header failure. Private App Server restart is deferred during active voice; voice leases are released after call closure and any delegated work finishes, with bounded retry checks. Neither calling-model discovery nor this one account test is treated as a universal entitlement check.

Sanitized evidence is in `qa/live-voice/silent-call-result.json`, `silent-call-default-diagnostic.json`, `silent-call-v3-diagnostic.json`, and `silent-call-v3-corrected.json`. The reproducible test harness is `qa/live-voice/silent-call.mjs` and requires explicit approval before execution. No further authenticated attempts were made after the approved corrected attempt succeeded.

The user subsequently approved private installation and the bridge interruption. The reconciled bridge upgrade is complete; config/pairing bytes and the LaunchAgent plist are unchanged, relay/Phonon health checks passed, and Qwen remains warm. Production build 59 is staged on the existing paired private route; anonymous manifest/APK requests returned 401. The existing ADB server lists no devices, so installation cannot be verified until the user confirms it in Settings → App updates on the watch. No new pairing or security settings were introduced. See `../../artifacts/private-install-plan.md` for exact rollback and remaining steps. Public Alpha/OTA delivery remains paused by the user's private-only constraint. Direct dot requires the supported host mediation interface described in the separate `dot-voice-linkage-findings.md` report; simple local thread substitution does not resolve it.


## Build 60 repair and physical evidence

The user installed build 59. A separate current ADB server discovered the watch through its existing authorized mDNS transport, without pairing or security changes. Read-only inspection confirms Pixel Watch 3, Android API 37, `armeabi-v7a,armeabi`, installed versionCode 59. Crash logs show repeated SIGABRT in WebRTC `JNI_OnLoad`: `java_class == null` at `GetStaticMethodID`. Build 58's ARM64-only package was incompatible with this actual userspace; build 59 restored ARM32 but omitted native shrinker contracts.

The prefixed AAR contains its Java code in `libs/shadow-all.jar`, ships no consumer keep rules, and also contains the shaded `livekit.org.jni_zero` bootstrap. Build 60 preserves all WebRTC entry points and annotated JNI-zero methods, including `JniZero.init`; it does not retain the unused bootstrap loader setter whose generated implementation is absent from the AAR. The first emulator candidate with only WebRTC rules reproduced missing `livekit.org.jni_zero.JniZero`, identifying the second required package.

The final exact signed release APK passed native factory/peer creation and a native SDP callback on the installed headless Wear OS 7 ARM64 emulator. The harness adds no tracks, sets no local description, starts no media capture, and opens no remote call. This verifies release JNI initialization; it does not verify physical ARM32 runtime, watch speech/audio, interruption or reconnection. The actual watch crash evidence is retained separately. No further authenticated voice attempt was made.

Build 60 uses the same production identity/signer, minimum/target SDK, permissions and required features as 59. It keeps both ARM ABIs and compresses JNI/DEX, with dependency resource languages English/German selected only for this private build to fit the unchanged 8 MiB limit. The app's own strings remain English; default builds retain all resource languages. APK: 8,327,670 bytes; SHA-256 `f6d4948904250dbe6380e1b6db0672c4a7c37f0a864c8b821656556f00d33b02`.

Voice preflight now checks the exact selected thread through bounded read-only `thread/read` before native transport construction or task attachment. A missing cloud task reports that a supported host connection is needed, while idle listed local tasks remain available. No model, effort or permission setting is changed. Partial native initialization now releases created resources, and shutdown continues to release audio resources even if Java cleanup fails. The chat UI preserves matching bridge errors rather than overwriting them with a generic Retry message.

Read-only discovery returned local task metadata/history in milliseconds but the current cloud task returned `thread not loaded`; the local registry did not include that task. Running a cloud task on the Mac does not itself expose the durable cloud connection to the CLI bridge. No supported cloud/dot mediation adapter was found; the existing source report remains the integration boundary. Chat retrieval for that cloud task is not fixed by the native repair.

115 focused tests in five files, TypeScript production/test checks and lint pass on both the isolated checkout and reconciled active bridge. The active owner's newer correction/filler code was preserved and compiled into the deployed bridge. Activation retained exact pairing/config bytes, no pending turns, unchanged LaunchAgent, executable rollback `bridge/dist.before-build60`, warm Phonon and the existing Qwen worker. Private update staging succeeded and anonymous manifest/APK returned 401. Build 60 installation and physical conversation remain unverified; use the watch's private App updates flow when awake. No unattended microphone/call testing, public upload or paid fallback occurred.

The user subsequently installed build60 (confirmed by read-only ADB version query) and reported a successful live connection with a spoken AI reply. This is physical voice acceptance of that basic flow. Long utterances, barge-in, reconnection and dot continuity remain unverified. The user requested a female default voice after hearing Cove.

The user corrected the preference to **Sol**, supported in the read-only V3/V1 catalog. The bridge advertises Sol as its watch default whenever supported, retaining the server catalog and entitlement status. This uses the existing watch60 capability flow and needs no APK update. 100 affected App Server/bridge tests pass; active owner dictation source remains intact. A read-only activity-services query returned no running watch services before activation, avoiding an active-call interruption.
