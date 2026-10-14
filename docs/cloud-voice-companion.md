# Full-duplex companion for cloud chats

Normal cloud chats currently lack a native call control in the observed client. Agentic Wear uses a private, temporary Codex v3 WebRTC voice session to speak with the caller and forward substantive requests to the selected cloud chat. The Watch owns microphone/speaker media; on-device transcription and read-aloud are not a fallback.

Each call binds one cloud destination. A single dynamic tool sends text with no model or effort overrides. Current cloud model/settings/history remain in that cloud chat. The companion runs on its own native App Server connection, uses an ephemeral thread, disables inherited MCP/App/shell/image/agent tools, and uses a read-only sandbox. It refuses a non-OpenAI inherited provider. Conversation context is bounded role-bearing data, separate from developer instructions.

Browser sends are correlated using the receipt's nativeTurnId and stable Watch request ID. Only that request's final cloud answer can complete the voice tool. Duplicate invocation IDs and identical messages reuse one result, including uncertain failures. Distinct requests queue serially while audio stays open. Unconfirmed delivery stops further automatic sends until the caller checks the chat and starts another call.

Ending a call aborts outstanding waits, stops/releases only its private voice session and leaves already submitted cloud work running. Failed cleanup resets only the companion's private process. Startup cancellation cannot create a later call. Existing local/Dot calls retain their routes. The companion's verified catalog enables the Watch default Bluetooth network route.

Verification: focused native host/RPC, gateway, lifecycle, receiver receipts and existing affected App Server checks; signed Watch unit/lint/assembly and public updater integrity. Real voice, interruption, Bluetooth performance and physical display lifecycle remain user acceptance. No agent-side voice call was made.
