# Design QA — Wear model and reasoning selector

## Evidence

- Source visual truth:
  - `/tmp/codex-remote-attachments/01a04a45-f98c-7c60-b84d-1205c6ff65d7/536bebd8-6472-46a0-bb32-ba442575444c/1-Photo-1.jpg`
  - `/tmp/codex-remote-attachments/01a04a45-f98c-7c60-b84d-1205c6ff65d7/536bebd8-6472-46a0-bb32-ba442575444c/2-Photo-2.jpg`
- Final implementation captures:
  - Closed control: `/tmp/agentic-transcript.png`
  - Six advertised effort states, Low through Ultra: `/tmp/agentic-effort-all.png`
  - Disabled-animation-scale selector: `/tmp/agentic-scale-zero.png`
- Combined comparison inputs opened and reviewed:
  - Closed full view: `/tmp/agentic-wear-comparison-closed.png`
  - Open full view: `/tmp/agentic-wear-comparison-full.png`
  - Open focused effort region: `/tmp/agentic-wear-comparison-effort.png`
  - Final short-copy comparison: `/tmp/agentic-wear-comparison-copy-final.png`
- Viewport: Android Wear OS round emulator `emulator-5556`, 454 × 454 physical px at 320 dpi, 227 × 227 dp logical viewport.
- Source dimensions: both references are 574 × 1280 px with 1 × 1 file-density metadata. Implementation dimensions: 454 × 454 physical px at device scale 2 relative to dp.
- Density normalization: the full open source was Lanczos-scaled to 204 × 454 beside the native 454 × 454 implementation. The focused source crop (574 × 280 at y=560) was scaled to 454 × 222 and padded to 454 × 260 beside a native 454 × 260 implementation crop. The source is a phone viewport and the implementation is a round watch, so comparison targets design language and control proportions rather than false pixel-for-pixel device-frame parity.
- State: transcript review; selector closed and selector open; GPT-5.6-Sol with Low, Medium, High, Extra High, Max, and Ultra. Horizontal model-scroll and GPT-5.6-Terra selection were also exercised.

## Findings

- No actionable P0, P1, or P2 issues remain.
- Fonts and typography: native Android system type preserves the source's compact sans-serif character. The short violet effort title has a clear hierarchy over `Drag to change effort level` and the endpoint labels. Every advertised title from Low through Ultra fits at full size; model titles and defaults remain readable without crowding the selected card.
- Spacing and layout rhythm: the selected track and model card remain inside the round safe region. Removing the original inset modal border restores breathing room and keeps the selected model fully visible; neighboring card peeks communicate horizontal scrolling without competing with the primary choice.
- Colors and visual tokens: the near-black scrim, low-contrast charcoal rail, violet progress fill, muted inactive stops, and white thumb closely match the reference. The stronger final scrim retains context without allowing transcript copy to overpower the selector.
- Image quality and asset fidelity: the reference control contains no app-owned raster imagery that needs reproduction. All selector icons use the Compose Material icon library; no raster placeholders, emoji, text-glyph controls, handcrafted SVGs, or custom-drawn icon substitutes were introduced.
- Copy and content: short tier names, `Drag to change effort level`, endpoint labels, `MODEL`, and `Next turn` are concise and coherent on Wear. Dynamic model names and advertised default effort remain source-backed; Ultra appears only when the bridge advertises it.
- Icons and affordances: the closed control uses Material `Speed` and `KeyboardArrowDown`; the overlay uses Material `Close` and `Check`. The close target exposes a 44–48 dp effective target and every model remains a labeled, selected-state-aware button.
- States and interaction: open, close, backdrop dismiss, discrete drag from Low through Ultra, horizontal carousel scroll, model selection, and effort normalization all passed on the emulator. Selecting Terra while Max was active correctly normalized effort to Medium.
- Accessibility: the effort control and models expose descriptive semantics, the effort rail is a SeekBar with range/set-progress semantics, the selected model is marked checked, and obscured transcript content is hidden from accessibility while the selector is open. The final tree contains no unnamed full-screen button. Crash buffer remained empty.
- Responsiveness: the final 454 px round viewport has no overlap, selected-control clipping, or hidden persistent selector action. Ten warm open/close cycles rendered 290 frames with 6.90% jank, 18 ms p50, 22 ms p90, 23 ms p95, and 34 ms p99; the selector also opened correctly with Android animator duration scale set to zero. The phone reference's keyboard and device chrome were treated as platform-owned context rather than recreated.

## Comparison history

1. Baseline comparison: `/tmp/agentic-wear-comparison-baseline.png`
   - Earlier P1: the large violet-bordered inset panel dominated the round display and obscured the lightweight overlay character of the reference.
   - Earlier P2: narrow 78 dp model cards truncated both model names, the carousel sat against the lower circle edge, the custom equalizer drawing and text-glyph close control were inconsistent with standard icons, and the dense label/divider treatment reduced hierarchy.
   - Fixes: replaced the inset panel with an edge-to-edge dimmed overlay; adopted native Material icons; introduced the reference-led violet segmented rail and large white thumb; centered a 128 dp selected card with neighbor peeks; simplified labels, borders, and surfaces.
2. First refined pass: `/tmp/agentic-wear-refined-open-v1.png`
   - Earlier P2: the upper scrim left background type too prominent, and default text line heights pushed the carousel low enough for the round mask to clip its selected card.
   - Fixes: strengthened the scrim, set optical line heights for compact labels, and moved the carousel upward while preserving touch targets.
3. Accessibility pass: `/tmp/agentic-wear-refined-open-v2.xml` and `/tmp/agentic-wear-refined-open-v3.xml`
   - Earlier P2: the dismiss backdrop appeared as an unnamed full-screen accessibility button; removing it initially exposed obscured transcript semantics.
   - Fixes: changed the backdrop to a non-semantic tap layer and hid the underlying transcript subtree while the selector is open.
   - Post-fix evidence: `/tmp/agentic-wear-final-high.xml` contains only selector content, a labeled close control, SeekBar semantics, and labeled model choices.
4. Final combined review: `/tmp/agentic-wear-comparison-full.png`, `/tmp/agentic-wear-comparison-effort.png`, and `/tmp/agentic-wear-comparison-copy-final.png`
   - The source and implementation now share the same clear effort emphasis, pill proportion, purple progress treatment, discrete stops, white thumb, and restrained dark scrim. No P0/P1/P2 differences remain after the Wear-specific adaptation.

## Follow-up polish

- P3: test unusually long bridge-provided model display names at larger system font scales; the current bounded single-line ellipsis is safe, but compact aliases could be considered if real catalogs routinely exceed the selected-card width.

## Implementation checklist

- [x] Preserve model catalog, persistence, bridge, and reasoning-policy behavior.
- [x] Use standard icon-library primitives.
- [x] Keep selected controls inside the round safe region.
- [x] Verify open/close, backdrop dismiss, effort drag, model scroll/select, and normalization.
- [x] Verify every advertised effort title through Ultra and disabled-animation-scale behavior.
- [x] Verify UI-tree labels, selection state, range semantics, modal background hiding, and crash buffer.
- [x] Compare reference and implementation in combined full and focused visual inputs.

final result: passed
