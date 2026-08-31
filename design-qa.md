# Design QA — Agentic Wear 0.6.10 Alpha

## Scope

- Reference states: the supplied round-watch home and send-options screenshots.
- Implementation states: round home, listening, transcribing, send options, and live chat; compact square home, listening, transcribing, send options, and live chat.
- Primary viewport: 454 × 454 px round, density 2, 227 dp logical size.
- Secondary viewport: 360 × 360 px square, density 2, 180 dp logical size.

## Comparison method

The supplied references and matching emulator captures were placed in one combined comparison sheet before review. Local inspection covered full-screen safe areas and focused crops for the top status/session region, broad voice-cancellation field, send-options close target, bottom action geometry, and localized live-chat glass field.

## Iterations

1. The active-voice cancellation treatment was iterated into a broad coral field around the unchanged inner orb, with device-dependent geometry and dedicated label spacing.
2. The compact square send-options stack initially clipped its queue action. It now uses a shorter header and compact 44 dp choice rows.
3. Compact square live-chat actions initially wrapped and collided. The action bar now uses bounded 40 dp weighted controls, a compact bottom inset, and only shows Retry when an error exists.
4. The square live-session header initially ellipsized behind the back control. Its asymmetric safe padding now leaves the title readable.
5. Motion review found an instantaneous home reflow, touch-only cancellation semantics, identical cancellation/stop haptics, stale glass interactivity during exit, and a radial hit mismatch. Synchronized layout transitions, semantic cancellation, a Reject haptic, immediate exit gating, and measured-bounds hit geometry resolved all five findings.

## Verification

- Round and square screenshots show no clipping or collisions in the tested states.
- Both listening and transcribing expose the same broad coral cancellation field while preserving the normal inner orb.
- The field and otherwise empty active-screen background cancel by touch, its semantic action is available for accessibility, and cancellation remains immediate at normal, disabled, and 10× animation scales.
- Steer and Queue share the same mint treatment; the round close target remains fully inside the bezel.
- Live chat uses a localized feathered haze behind Voice reply without blurring the rest of the screen.
- Gemini 3.7 Flash at High reasoning in Antigravity flagged the first round helper-text placement, then passed the corrected round/square comparison after the active stack was moved into the safe area.
- The dedicated Max-effort motion review approved the final interaction and transition implementation.

final result: passed
