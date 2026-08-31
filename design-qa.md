# Design QA — Agentic Wear 0.6.11 Alpha

## Scope

- Reference states: the supplied round-watch home, voice-cancellation, and live-session screenshots.
- Implementation states: round and compact-square home, listening, transcribing, and active live chat.
- Primary viewport: 454 × 454 px round, density 2, 227 dp logical size.
- Secondary viewport: 360 × 360 px square, density 2, 180 dp logical size.

## Comparison method

The supplied references and matching emulator captures were placed in combined comparison sheets before review. Local inspection covered the redesigned voice surface at idle, listening, and transcribing states; the diffuse outside-cancel field; live-thinking treatment; full-screen safe areas; and compact readability.

## Iterations

1. The broad coral cancellation field was changed from an annular treatment to a continuous radial falloff that reaches full transparency without a visible outer contour.
2. The central transcription control was rebuilt as a layered voice surface with a directional dark lens, cyan/violet edge light, a restrained specular highlight, and a recessed inner well while retaining the established Agentic glyph.
3. Idle, listening, and transcribing renders were checked at 454 px round and 360 px compact-square sizes; the compact control remains legible and the state-specific treatments remain distinct.
4. Live chat now exposes a compact “Agent is thinking” state with a polite accessibility announcement and reduced-motion fallback.
5. Motion review found that unresolved non-actionable permissions could be mislabeled as thinking and that thinking-start did not always follow the latest content. Both cases now suppress or reposition the indicator correctly.

## Verification

- Round and square screenshots show no clipping or collisions in idle, listening, transcribing, or thinking states.
- Listening and transcribing preserve the broad outside-cancel target while the redesigned inner control remains visually and behaviorally separate.
- The diffuse coral halo and thinking indicator passed a dedicated Gemini 3.7 Flash High review in Antigravity.
- The six-panel redesigned transcription-control comparison passed a second Gemini 3.7 Flash High production gate.
- Normal, disabled, and 10× motion renders remain readable; permission waits no longer present as active reasoning.

final result: passed
