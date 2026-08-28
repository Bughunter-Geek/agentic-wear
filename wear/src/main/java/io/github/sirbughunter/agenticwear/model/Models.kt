package io.github.sirbughunter.agenticwear.model

enum class SessionStatus { ACTIVE, IDLE, NOT_LOADED, ERROR }

data class AgentSession(
    val id: String,
    val title: String,
    val updatedAtMillis: Long,
    val status: SessionStatus,
    val ownedByWear: Boolean,
    val canAcceptDirectInput: Boolean,
)

enum class AlertKind { COMPLETE, PERMISSION, ERROR }

data class AgentAlert(
    val eventId: String,
    val kind: AlertKind,
    val threadId: String,
    val title: String,
    val detail: String,
    val occurredAtMillis: Long,
    val approvalId: String? = null,
    val canControl: Boolean = false,
)

enum class TranscriptionEngine { BRIDGE_WHISPER, DEVICE_SPEECH }

enum class ApprovalMode { ALERT_ONLY, ALLOW_CONTROLS }

const val MAX_TRANSCRIPT_CHARS = 12_000

data class Transcript(
    val requestId: String,
    val text: String,
    val threadId: String?,
    val revised: Boolean = false,
)

enum class ChatPhase { COMMENTARY, FINAL_ANSWER, UNKNOWN }

data class ChatParagraph(
    val id: String,
    val text: String,
    val phase: ChatPhase,
)

data class ChatSnapshot(
    val threadId: String,
    val title: String,
    val status: SessionStatus,
    val paragraphs: List<ChatParagraph>,
    val generatedAtMillis: Long,
    val requestId: String? = null,
)

sealed interface BridgePayload {
    val requestId: String

    data class SessionSync(override val requestId: String) : BridgePayload
    data class CreateTranscription(
        override val requestId: String,
        val audioBase64: String,
        val mimeType: String,
        val threadId: String?,
        val previousText: String?,
    ) : BridgePayload
    data class SubmitTurn(
        override val requestId: String,
        val threadId: String?,
        val text: String,
    ) : BridgePayload
    data class ApprovalResponse(
        override val requestId: String,
        val approvalId: String,
        val decision: String,
    ) : BridgePayload
    data class WatchChat(
        override val requestId: String,
        val threadId: String,
    ) : BridgePayload
    data class UnwatchChat(
        override val requestId: String,
        val threadId: String,
    ) : BridgePayload
}
