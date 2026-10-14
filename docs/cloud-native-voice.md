# Current live voice routes

Local tasks use native Codex App Server WebRTC voice. Dot calls use the selected/configured Dot's native Chrome call with Watch-owned microphone/speaker media. Ordinary cloud chats use the [scoped ephemeral Mac companion](cloud-voice-companion.md); they do not depend on a native Start voice chat button and do not implicitly start transcription/read-aloud. Dictation remains separate.

Enable Agentic Wear Cloud Receiver (Relay) in Chrome. For Dot, open your own Dot, end any current call and choose Connect this Dot; the companion's private target must match. Receiver absence, disabled state or unavailable selection is a setup failure, not evidence that a local Codex host lacks voice support. The watch shows route-specific guidance without guessing the exact setup cause.

Ordinary cloud voice forwards substantive requests/results to the selected chat; full spoken transcripts are not automatically saved. Selected-chat model/settings/tools are retained. The companion cannot execute inherited local tools. Existing personal calls are never taken over. Ending voice leaves already submitted cloud work running, and uncertain submissions are not automatically repeated.

Current user acceptance covers voice on the maintainer's setup. Other devices, interruption/handover/reconnect and network conditions remain limited-tester acceptance items. See PRIVACY.md for media and external processing.

Alpha1 approval cards are alert-only because full concrete authority is not yet rendered. Decide in Codex. Relay-flood memory pressure and large-Unicode-history receiver disconnection are known availability issues deferred to Alpha1.1.
