Agentic Wear browser cloud adapter (0.2.0)

Runs beside unmodified, updatable official Codex. Chrome must remain signed in,
with the configured chat and Dot pages open; the Mac must stay awake and online.
The VPN is required for this account's region. No ChatGPT tokens are extracted.
The native helper reads page observations, relays messages through the paired
Watch bridge, and submits Watch text through the page's ordinary composer.

Currently connected:
- Extract current Claude instructions: 01a1188b-a850-755b-91ec-717f6182900a
- Actual Dot Lumen: dot:fa24ed5a57dc8199b97f68f7d0098d11
Other cloud chats are not automatically connected.

Both user prompts and final assistant text are preserved (latest 20 messages).
Cloud user messages include prompts submitted by the user, another task, or Dot
as displayed in that conversation. Authors beyond user/assistant are not guessed.
Existing desktop drafts, busy cloud generations, changed pages, and wrong Dot
identity block sending before mutation. Current model/effort are preserved.

Watch sends have persistent request fingerprints and pre-dispatch claims. A lost
acknowledgement is uncertain, never permission to repeat the click. Check-status
commands only reconcile an existing receipt; they cannot send new text. Canonical
message IDs and Watch request IDs link optimistic echoes to actual history.
A native-clock observation request every 10 seconds avoids hidden-tab heartbeat
throttling. DOM mutations still deliver replies immediately.

Phonon-2 remains configured by AGENTIC_WEAR_ENV_FILE pointing to the original
bridge .env.local. Verified by the user on the physical Watch on 2026-10-11.

Integrated Claude build85 bridge commits through b7b2fab80d21a78f5d737d0787e5447401641d55,
including question.answer support. Canonical Claude checkout was not edited.
The installed integrated bridge is separate: do not replace it with a plain
canonical build, which lacks the browser adapter. Merge future Claude bridge
changes into this integration and test before updating the active service.

Validation: 527 bridge tests passed after build85 integration. Subsequent focused
native-host/Unix socket/request dedupe/restart/reconciliation/content DOM tests
passed. Physical text-send verification is still in progress; do not call it
accepted merely because tests pass. Earlier receive-only Watch posted receipts
were 3.936s and 1.308s from browser detection, not total generation latency.

Known Watch-side issue observed during deployment: an uncertain pending request
is global and can show Check status in unrelated chats. Verified cloud test was
reconciled to its real turn, and the Dot attempt interrupted before dispatch was
rejected with its draft retained. Per-chat Watch pending state remains a separate
Watch UI/storage fix, not solved merely by reconciling these test receipts.
