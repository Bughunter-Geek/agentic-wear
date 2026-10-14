package io.github.sirbughunter.agenticwear.model

enum class SessionStatus { ACTIVE, IDLE, NOT_LOADED, ERROR }

// Two bounded native lists:20 pages of50 recent tasks and20 pages of50 pins.
const val MAX_LOCAL_SESSION_SNAPSHOT = 2_000

data class AgentSession(
    val id: String,
    val title: String,
    val updatedAtMillis: Long,
    val status: SessionStatus,
    val ownedByWear: Boolean,
    val canAcceptDirectInput: Boolean,
    val watchReady: Boolean = false,
    val pinned: Boolean = false,
    val source: String? = null,
    /** "question" | "approval" when the chat is waiting for the user; null otherwise. */
    val attention: String? = null,
    /** Browser-route cloud chats only: selectable models and reasoning levels reported by the bridge. */
    val cloud: CloudModelInfo? = null,
    /** Dot chats only: whether the native voice channel is ready; null when the bridge doesn't say. */
    val voiceReady: Boolean? = null,
)

data class CloudModelInfo(
    val model: String?,
    val models: List<String>,
    val effortIndex: Int?,
    val effortLabel: String?,
    /** Reasoning labels by slider index; empty when the bridge did not report them. */
    val efforts: List<String>,
)

enum class ModelPicker { MAC, CLOUD, NONE }

/** Mac chats keep the Codex picker, cloud chats get one only when the bridge reported options, Dot never. */
fun modelPickerFor(source: String?, cloud: CloudModelInfo?): ModelPicker = when (source) {
    "dot" -> ModelPicker.NONE
    "cloud" -> if (cloud != null && cloud.models.isNotEmpty()) ModelPicker.CLOUD else ModelPicker.NONE
    else -> ModelPicker.MAC
}

data class CloudSelection(val model: String?, val effortIndex: Int?)

/** Preserve explicit advertised choices so the browser verifies them even if cached settings match. */
fun cloudSelectionToSend(info: CloudModelInfo?, chosenModel: String?, chosenEffortIndex: Int?): CloudSelection {
    if (info == null) return CloudSelection(null, null)
    val model = chosenModel?.takeIf { it in info.models }
    val limit = if (info.efforts.isEmpty()) 0 else info.efforts.size
    val effort = chosenEffortIndex?.takeIf { it in 0 until limit }
    return CloudSelection(model, effort)
}


/**
 * A model advertised by the private Codex bridge.
 *
 * The bridge owns the catalog so the watch never has to ship a stale list of
 * model IDs. `model` is the value sent back to App Server for a turn; `id` is
 * retained for diagnostics and future catalog updates.
 */
data class ModelOption(
    val id: String,
    val displayName: String,
    val model: String,
    val defaultReasoningEffort: String,
    val supportedReasoningEfforts: List<String>,
)

object ReasoningEffortPolicy {
    const val DEFAULT = "medium"

    val FALLBACK_OPTIONS: List<String> = listOf("low", "medium", "high", "xhigh")

    fun normalize(value: String?): String {
        val candidate = value?.trim()?.lowercase().orEmpty()
        return candidate.takeIf(::isSafeValue) ?: DEFAULT
    }

    fun options(model: ModelOption?): List<String> {
        val advertised = model?.supportedReasoningEfforts
            ?.map(::normalize)
            ?.distinct()
            ?.take(MAX_OPTIONS)
            .orEmpty()
        return if (advertised.isEmpty()) FALLBACK_OPTIONS else advertised
    }

    fun defaultFor(model: ModelOption?): String {
        val options = options(model)
        val advertised = model?.defaultReasoningEffort?.let(::normalize)
        return advertised?.takeIf(options::contains)
            ?: DEFAULT.takeIf(options::contains)
            ?: options.first()
    }

    fun label(value: String): String = when (normalize(value)) {
        "low" -> "Low"
        "medium" -> "Medium"
        "high" -> "High"
        "xhigh" -> "Extra High"
        "max" -> "Max"
        "ultra" -> "Ultra"
        else -> normalize(value)
            .replace('-', ' ')
            .replace('_', ' ')
            .split(' ')
            .filter(String::isNotBlank)
            .joinToString(" ") { word -> word.replaceFirstChar { it.uppercase() } }
    }

    fun isSafeValue(value: String): Boolean = value.length in 1..32 &&
        value.all { it.isLetterOrDigit() || it in "-_.:" }

    private const val MAX_OPTIONS = 8
}

enum class AlertKind { COMPLETE, PERMISSION, ERROR, QUESTION }

data class AgentAlert(
    val eventId: String,
    val kind: AlertKind,
    val threadId: String,
    val title: String,
    val detail: String,
    val occurredAtMillis: Long,
    val approvalId: String? = null,
    val canControl: Boolean = false,
    /** QUESTION alerts only: answer choices (at most [MAX_QUESTION_OPTIONS]), the agent message item id and question index. */
    val options: List<String> = emptyList(),
    val questionItemId: String? = null,
    val questionIndex: Int = 0,
)

const val MAX_QUESTION_OPTIONS = 4

enum class TranscriptionEngine { BRIDGE_WHISPER, BRIDGE_PHONON, DEVICE_SPEECH;
    val usesBridge: Boolean get() = this != DEVICE_SPEECH
    val bridgeBackend: String? get() = when (this) {
        BRIDGE_WHISPER -> "whisper"
        BRIDGE_PHONON -> "phonon"
        DEVICE_SPEECH -> null
    }
}

enum class ApprovalMode { ALERT_ONLY, ALLOW_CONTROLS }

enum class FollowUpAction(val wireValue: String) {
    DEFAULT("default"),
    QUEUE("queue"),
    STEER("steer"),
}

const val MAX_TRANSCRIPT_CHARS = 12_000

data class Transcript(
    val requestId: String,
    val text: String,
    val threadId: String?,
    val revised: Boolean = false,
    val rawText: String? = null,
    val undoText: String? = null,
    val editNotice: String? = null,
    val editChoices: List<String> = emptyList(),
)

enum class ChatPhase { COMMENTARY, FINAL_ANSWER, UNKNOWN }

enum class ChatRole { USER, ASSISTANT }

enum class ChatMessageKind { MESSAGE, PERMISSION }

enum class FeedbackRating { LIKED, DISLIKED }

data class ChatParagraph(
    val id: String,
    val text: String,
    val phase: ChatPhase,
)

data class ChatQuestion(
    val title: String,
    val options: List<String> = emptyList(),
)

data class ChatMessage(
    val id: String,
    val turnId: String,
    val role: ChatRole,
    val text: String,
    val phase: ChatPhase,
    val kind: ChatMessageKind = ChatMessageKind.MESSAGE,
    val approvalId: String? = null,
    val canControl: Boolean = false,
    val resolved: Boolean = false,
    val watchRequestId: String? = null,
    /** Assistant messages only: questions the agent asked (bridge build 85+). */
    val questions: List<ChatQuestion> = emptyList(),
    val questionItemId: String? = null,
    val answered: Boolean = false,
) {
    /** Unanswered assistant message that still waits for the user's answer. */
    val needsAnswer: Boolean
        get() = role == ChatRole.ASSISTANT && kind == ChatMessageKind.MESSAGE &&
            questions.isNotEmpty() && !questionItemId.isNullOrBlank() && !answered
}

object ChatDisplayPolicy {
    fun startsCollapsed(message: ChatMessage, collapseUpdates: Boolean): Boolean =
        collapseUpdates &&
            message.kind == ChatMessageKind.MESSAGE &&
            message.role == ChatRole.ASSISTANT &&
            message.phase == ChatPhase.COMMENTARY
}

data class ChatSnapshot(
    val threadId: String,
    val title: String,
    val status: SessionStatus,
    val paragraphs: List<ChatParagraph>,
    val generatedAtMillis: Long,
    val requestId: String? = null,
    val messages: List<ChatMessage> = paragraphs.map { paragraph ->
        ChatMessage(
            id = paragraph.id,
            turnId = paragraph.id,
            role = ChatRole.ASSISTANT,
            text = paragraph.text,
            phase = paragraph.phase,
        )
    },
    /** True for a trimmed inline snapshot that must be merged into, not replace, the stored chat. */
    val partial: Boolean = false,
    val cloud: CloudModelInfo? = null,
)

const val MAX_MERGED_CHAT_MESSAGES = 12

/**
 * Merges a partial snapshot into the stored chat of the same thread: keeps current messages up to
 * the first incoming id already present, then appends all incoming ones; dedupes by id, newest 12.
 * Non-partial snapshots (or a different thread) replace the current one.
 */
fun mergeChatSnapshot(current: ChatSnapshot?, incoming: ChatSnapshot): ChatSnapshot {
    if (!incoming.partial || current == null || current.threadId != incoming.threadId) return incoming
    val currentIds = current.messages.map { it.id }.toSet()
    val firstOverlap = incoming.messages.firstOrNull { it.id in currentIds }?.id
    val kept = if (firstOverlap == null) current.messages else current.messages.takeWhile { it.id != firstOverlap }
    val merged = LinkedHashMap<String, ChatMessage>()
    (kept + incoming.messages).forEach { merged[it.id] = it }
    return incoming.copy(messages = merged.values.toList().takeLast(MAX_MERGED_CHAT_MESSAGES), cloud = incoming.cloud ?: current.cloud)
}

/** Dot and cloud chats run through the browser route, which cannot change model, effort or speed. */
fun supportsModelSelection(source: String?): Boolean = source != "dot" && source != "cloud"

sealed interface BridgePayload {
    val requestId: String

    data class SessionSync(override val requestId: String) : BridgePayload
    data class PrepareDraft(override val requestId: String) : BridgePayload
    data class CreateTranscription(
        override val requestId: String,
        val audioBase64: String,
        val mimeType: String,
        val threadId: String?,
        val previousText: String?,
        val backend: String? = null,
        val finalIntent: Boolean = false,
        val localEdit: Boolean = false,
    ) : BridgePayload
    data class SubmitTurn(
        override val requestId: String,
        val threadId: String?,
        val text: String,
        val model: String? = null,
        val effort: String = ReasoningEffortPolicy.DEFAULT,
        /** Cloud chats: [model] is a display name (may contain spaces) and this is the slider index. */
        val cloudEffortIndex: Int? = null,
        val cloudModel: Boolean = false,
        val followUpAction: FollowUpAction = FollowUpAction.DEFAULT,
    ) : BridgePayload
    /** Answers an agent question; the bridge wraps it into the normal user-message path. */
    data class AnswerQuestion(
        override val requestId: String,
        val threadId: String,
        val questionItemId: String,
        val questionIndex: Int,
        val answer: String,
        val question: String? = null,
    ) : BridgePayload
    data class ApprovalResponse(
        override val requestId: String,
        val approvalId: String,
        val decision: String,
    ) : BridgePayload
    data class SubmitFeedback(
        override val requestId: String,
        val threadId: String,
        val turnId: String,
        val itemId: String,
        val rating: FeedbackRating,
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
