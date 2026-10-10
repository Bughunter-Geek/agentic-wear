# Voice with native Codex tasks — private build 61

This change extends the accepted build60 media/runtime repair and the deployed Sol default. It keeps Phonon and Qwen dictation separate, with no paid API fallback, new credentials, persistent permission expansion or dot substitution.

## Task identity and execution

Connect attaches the selected idle local task, preserving its native model, reasoning, folder and permission policy. The voice screen displays the actual task metadata returned by App Server. An unavailable cloud task still fails preflight before native transport setup.

“New local voice task” is a separate explicit action. It creates and names an empty native task in the bridge's configured folder using host defaults. It does not send a turn, capture audio, connect voice, permanently acquire approval authority, or identify the user's account dot. An uncertain creation response tells the user to inspect Sessions before creating another task.

The official realtime implementation delegates native work automatically when `clientManagedHandoffs` is false. Agentic Wear now makes that setting explicit and displays actual native handoff/turn/tool/approval/completion events. It never dispatches a raw voice function payload as an additional `turn/start` request.

## Human decisions

The existing watch approval preference remains alert-only by default. Explicit controls require the existing Settings → Approvals opt-in, a successfully accepted watch voice start, and an exact native turn observed after that start. Rejected/in-flight starts and unrelated tasks/turns cannot acquire controls. Permission grants return only the exact requested profile with `scope: turn`; command/file decisions do not request persistent session approval. No automatic approval is added.

The native Turn schema does not expose voice-call provenance. The temporary authority is therefore scoped to observed native turns in the selected idle task for the accepted call; it is not proof of the initiating audio utterance. It is removed at completion/release. Ending media retains authority only for an already observed delegated turn while native work is active, allowing its normal task approval UI to finish it. Requests too large to fully review on the watch remain desktop-only. Unsupported human-input requests also need the native Codex UI.

The voice screen shows the request reason, command/folder when supplied, and exact one-turn permission profile. Approve/Decline use the existing encrypted decision path. Native resolution and bridge receipt clear the voice permission wait. “Open task” opens the existing complete task/approval UI; it does not stop media. A later terminal event clears the pending voice state.

## Real media and lifecycle

The orb uses native input speech, response and output-buffer events plus WebRTC `audioLevel` stats. Its size follows observed levels; no timer creates a waveform or simulated work. Muted input cannot drive the orb. Permission waits take precedence over thinking/speaking labels. Native work and terminal status have separate text from media captions.

A disconnection is visible as Reconnecting with Mute/End still available. The existing ten-second grace, startup bounds, heartbeat lease, explicit reconnect, audio-focus handling and two-hour resource limit remain. Existing dictation entry points refuse to overlap live media and retain the draft. The voice screen supports the watch crown and touch scrolling.

## Native session data and boundaries

Pinned membership and order come from Codex's reserved native section identity and `section_position`; names/titles are not pin evidence. Recent and pinned tasks are merged and bounded to the existing 50-task watch snapshot. Activity lists the last 20 actual Codex completion/error/permission events received by this watch; it is not an account-wide activity feed.

Priority shows native active/error tasks and explains that desktop unread state is unavailable. Scheduled explains that this local connection does not expose scheduled-task definitions, then separately shows recent threads with actual `threadSource: automation` metadata. These partial views do not claim parity with the desktop sidebar. Direct account dot and its durable conversation/media remain dependent on a supported host-owned selector and SDP/sideband adapter; see the separate source findings.

## Evidence and delivery status

Native subscription tools independently passed a read-only ephemeral marker-file test using `commandExecution`, exit 0 and exact result matching. Native pins independently returned 15 matching pinned tasks. Neither check opened voice or captured a microphone. A separate receive-only text-to-native-handoff test is prepared but requires the pending explicit approval before it can run; its result must not be inferred from the plaintext tool test.

Build61 source/build checks and synthetic emulator screens are separate from user acceptance of build60/Sol. Build61 is not yet installed on the watch or activated on the Mac. Long speech, barge-in, wrist-down continuation, handover/reconnect and tool execution through actual watch voice still require physical acceptance. No dot continuity is claimed.

## Private visual/decision revision2 (unreleased)

The review candidate now keeps scroll content inside a geometry-derived circular safe rectangle, uses centered48dp actions and nonoverlapping home dock targets, and collapses the task-view picker to one selected control. A selection resets scroll so the new scope label remains visible. Record prompt and review engine labels distinguish dictation from live voice; typed replies remain labeled Text reply. Historical Activity approvals stay read-only even if the stored event once allowed controls. Decisions compare the displayed exact request ID, refuse repeats while sending and become unavailable on disconnect or resolution.

The live orb adapts the user's inspected native reference cloud-disk appearance to the watch with10 selectable colours. A fixed-size canvas keeps the centre/layout still. Active finite input/output levels above the existing0.01 activity gate drive a bounded low-damping spring; pauses settle to baseline, muted input cannot drive it, and inactive/permission/reduced-motion views freeze. Production has no simulated breathing loop or extra microphone capture.

Validation:13 focused Android policy cases across4 classes pass with native-runtime flags; debug assembly/lint pass;227dp interactive scroll/history/decision/48dp bounds and actual category-selection checks pass;260dp affected round checks pass; silent synthetic debug motion shows bounded expansion/overshoot, fixed centre, final pause settling with identical settled stills, reduced-motion baseline and static permission stills. External Gemini3.8FlashMedium re-review remains pending. The separate debug APK and3 synthetic contact sheets live in ../artifacts/review-r2; they are not a release or production deployment. Build60/Sol/Phonon/Qwen remain unchanged.

The user's newly prioritized complete cloud/hybrid inventory is not implemented by these partial task views. Local discovery currently loses its next cursor and both bridge/watch snapshots truncate at50. Native desktop mixed-chat list/read tools exist, but this session's official MCP catalog check is rejected with `untrusted-code-signing-identity` by the desktop native peer guard. Complete authenticated all-host inventory/reading needs supported desktop mediation; no credentials, private endpoint or peer restriction is bypassed. Listing never proves reading, executing or voice entitlement.

## Separate local pagination candidate (not activated)

Local discovery follows opaque native cursors through up to20 pages of50 rows per recent/pinned list, with a15-second budget per list and a5-second per-page timeout. It stops repeated cursors, deduplicates overlap without overwriting native pinned order/metadata, and marks incomplete results on a cap or later failure. Initial-page failures still report an error. Existing interactive source and top-level-thread filters remain; all model providers are included. Native polling still uses its original single-page method. Watch decoding/persistence retains up to2000 merged rows, preserves selected task IDs, and labels local scope and partial results. This does not discover cloud/hybrid tasks or account Activity.

118 affected bridge tests pass across4 files, including8 discovery cases; production/test type checks and lint pass; native Android debug assembly/lint pass. Read-only current-host traversal reached573 top-level local chats over12 pages and15 native pins over1 page with complete cursors. The debug110-row JSON round-trip fixture is compiled but not run. It and rendered pagination acceptance remain before activation. The tested UI milestone remains commit d2e4000 and its saved review APK/screens are unchanged; this candidate is separate. No bridge/watch activation, publishing, native media call, new credentials or signing-trust workaround occurred.
