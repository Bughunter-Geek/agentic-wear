# Cloud status and voice startup

Private Watch build 113 reuses the local live-call Connecting orb and shimmer text while the cloud voice loop starts its microphone. Listening, reply waiting and playback retain their real phases; no artificial connection delay is added. Reduced-motion behavior comes from the existing shared components. Device/visual acceptance remains with the user.

The receiver reports current generation through a visible enabled Stop control. An unfinished historical reply remains completion/receipt evidence, not a perpetual Working signal. An explicit idle observation clears Working without inventing completion, and legacy observations with a ready composer also clear stale Working. Empty cloud pages can report real generation without establishing a historical completion baseline. Dot identity and Dot status semantics are unchanged.

Six regression tests fail against the previous observer and pass with this fix. Three browser DOM cases cover idle history, visible generation, and hidden/disabled Stop controls. Runtime delivery preserves existing local Dot selection and pairing; no public receiver package is replaced as part of this private test update.
