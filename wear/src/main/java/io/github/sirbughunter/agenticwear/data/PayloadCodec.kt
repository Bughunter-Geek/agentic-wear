package io.github.sirbughunter.agenticwear.data

import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AgentSession
import io.github.sirbughunter.agenticwear.model.AlertKind
import io.github.sirbughunter.agenticwear.model.BridgePayload
import io.github.sirbughunter.agenticwear.model.ChatParagraph
import io.github.sirbughunter.agenticwear.model.ChatPhase
import io.github.sirbughunter.agenticwear.model.ChatMessage
import io.github.sirbughunter.agenticwear.model.ChatMessageKind
import io.github.sirbughunter.agenticwear.model.ChatRole
import io.github.sirbughunter.agenticwear.model.ChatSnapshot
import io.github.sirbughunter.agenticwear.model.FeedbackRating
import io.github.sirbughunter.agenticwear.model.MAX_TRANSCRIPT_CHARS
import io.github.sirbughunter.agenticwear.model.ModelOption
import io.github.sirbughunter.agenticwear.model.ReasoningEffortPolicy
import io.github.sirbughunter.agenticwear.model.SessionStatus
import io.github.sirbughunter.agenticwear.model.Transcript
import org.json.JSONArray
import org.json.JSONObject

object PayloadCodec {
    fun encode(payload: BridgePayload): String = when (payload) {
        is BridgePayload.SessionSync -> JSONObject()
            .put("version", 1)
            .put("kind", "session.sync")
            .put("requestId", payload.requestId)
            .toString()
        is BridgePayload.CreateTranscription -> JSONObject()
            .put("version", 1)
            .put("kind", "transcription.create")
            .put("requestId", payload.requestId)
            .put("audioBase64", payload.audioBase64)
            .put("mimeType", payload.mimeType)
            .put("threadId", payload.threadId)
            .put("previousText", payload.previousText)
            .toString()
        is BridgePayload.SubmitTurn -> JSONObject()
            .put("version", 1)
            .put("kind", "turn.submit")
            .put("requestId", payload.requestId)
            .put("threadId", payload.threadId)
            .put("text", payload.text)
            .put("effort", ReasoningEffortPolicy.normalize(payload.effort))
            .apply { payload.model?.takeIf(::isSafeModelValue)?.let { put("model", it) } }
            .toString()
        is BridgePayload.ApprovalResponse -> JSONObject()
            .put("version", 1)
            .put("kind", "approval.respond")
            .put("requestId", payload.requestId)
            .put("approvalId", payload.approvalId)
            .put("decision", payload.decision)
            .toString()
        is BridgePayload.SubmitFeedback -> JSONObject()
            .put("version", 1)
            .put("kind", "feedback.submit")
            .put("requestId", payload.requestId)
            .put("threadId", payload.threadId)
            .put("turnId", payload.turnId)
            .put("itemId", payload.itemId)
            .put("rating", payload.rating.name.lowercase())
            .toString()
        is BridgePayload.WatchChat -> JSONObject()
            .put("version", 1)
            .put("kind", "chat.watch")
            .put("requestId", payload.requestId)
            .put("threadId", payload.threadId)
            .toString()
        is BridgePayload.UnwatchChat -> JSONObject()
            .put("version", 1)
            .put("kind", "chat.unwatch")
            .put("requestId", payload.requestId)
            .put("threadId", payload.threadId)
            .toString()
    }

    fun decodeSessions(json: JSONObject): List<AgentSession> {
        if (json.optInt("version") != 1 || json.optString("kind") != "sessions.snapshot") return emptyList()
        val data = json.optJSONArray("sessions") ?: return emptyList()
        return buildList {
            for (index in 0 until minOf(data.length(), 50)) {
                val value = data.optJSONObject(index) ?: continue
                val id = value.optString("id").takeIf(::isSafeId) ?: continue
                val title = clean(value.optString("title"), 100).ifEmpty { "Untitled session" }
                val status = when (value.optString("status")) {
                    "active" -> SessionStatus.ACTIVE
                    "idle" -> SessionStatus.IDLE
                    "error" -> SessionStatus.ERROR
                    else -> SessionStatus.NOT_LOADED
                }
                add(
                    AgentSession(
                        id = id,
                        title = title,
                        updatedAtMillis = value.optLong("updatedAt", 0L).coerceAtLeast(0L),
                        status = status,
                        ownedByWear = value.optBoolean("ownedByWear", false),
                        canAcceptDirectInput = value.optBoolean("canAcceptDirectInput", false),
                    ),
                )
            }
        }
    }

    fun decodeModels(json: JSONObject): List<ModelOption> {
        if (json.optInt("version") != 1 || json.optString("kind") != "sessions.snapshot") return emptyList()
        val data = json.optJSONArray("models") ?: return emptyList()
        return buildList {
            for (index in 0 until minOf(data.length(), 50)) {
                val value = data.optJSONObject(index) ?: continue
                val model = value.optString("model").takeIf(::isSafeModelValue) ?: continue
                val id = value.optString("id").takeIf(::isSafeModelValue) ?: model
                val displayName = clean(value.optString("displayName"), 80).ifEmpty { model }
                val efforts = value.optJSONArray("supportedReasoningEfforts")
                    ?.let { effortArray ->
                        buildList {
                            for (effortIndex in 0 until minOf(effortArray.length(), 8)) {
                                val effort = effortArray.optString(effortIndex)
                                    .takeIf(ReasoningEffortPolicy::isSafeValue)
                                    ?: continue
                                add(ReasoningEffortPolicy.normalize(effort))
                            }
                        }
                    }
                    ?.distinct()
                    .orEmpty()
                val supportedEfforts = if (efforts.isEmpty()) ReasoningEffortPolicy.FALLBACK_OPTIONS else efforts
                val defaultEffort = ReasoningEffortPolicy.normalize(value.optString("defaultReasoningEffort"))
                    .takeIf(supportedEfforts::contains)
                    ?: supportedEfforts.first()
                add(ModelOption(id, displayName, model, defaultEffort, supportedEfforts))
            }
        }.distinctBy { it.model }
    }

    fun decodeAlert(json: JSONObject): AgentAlert? {
        if (json.optInt("version") != 1) return null
        val wireKind = json.optString("kind")
        if (!acceptsAlertEnvelope(wireKind, json.optString("turnScope"))) return null
        val kind = when (wireKind) {
            "terminal.completed" -> AlertKind.COMPLETE
            "terminal.failed", "terminal.interrupted", "terminal.blocked" -> AlertKind.ERROR
            "approval.request" -> AlertKind.PERMISSION
            else -> return null
        }
        val eventId = json.optString("eventId").takeIf(::isSafeId) ?: return null
        val threadId = json.optString("threadId").takeIf(::isSafeId) ?: return null
        val title = clean(json.optString("title"), 100).ifEmpty { "Agent session" }
        val detail = fullAlertDetail(json.optString("detail")).ifEmpty {
            when (kind) {
                AlertKind.COMPLETE -> "The agent finished its work."
                AlertKind.PERMISSION -> "The agent needs your decision."
                AlertKind.ERROR -> "The agent stopped before completing its work."
            }
        }
        return AgentAlert(
            eventId = eventId,
            kind = kind,
            threadId = threadId,
            title = title,
            detail = detail,
            occurredAtMillis = json.optLong("occurredAt", System.currentTimeMillis()),
            approvalId = json.optString("approvalId").takeIf(::isSafeId),
            canControl = json.optBoolean("canControl", false),
        )
    }

    fun decodeRequestError(
        json: JSONObject,
        envelopeMessageId: String,
        envelopeSentAt: Long,
        fallbackThreadId: String?,
        fallbackTitle: String?,
    ): AgentAlert? {
        if (json.optInt("version") != 1 || !isRequestErrorKind(json.optString("kind"))) return null
        val eventId = envelopeMessageId.takeIf(::isSafeId) ?: return null
        val threadId = json.optString("threadId").takeIf(::isSafeId)
            ?: fallbackThreadId?.takeIf(::isSafeId)
            ?: "agentic-wear"
        val title = clean(json.optString("title"), 100).ifEmpty {
            clean(fallbackTitle.orEmpty(), 100).ifEmpty { "Agentic Wear request" }
        }
        val detail = fullAlertDetail(json.optString("message"))
            .ifEmpty { "The request could not be completed." }
        return AgentAlert(
            eventId = eventId,
            kind = AlertKind.ERROR,
            threadId = threadId,
            title = title,
            detail = detail,
            occurredAtMillis = envelopeSentAt.takeIf { it > 0L } ?: System.currentTimeMillis(),
        )
    }

    fun decodeTranscript(json: JSONObject): Transcript? {
        if (json.optInt("version") != 1 || json.optString("kind") != "transcription.ready") return null
        val requestId = json.optString("requestId").takeIf(::isSafeId) ?: return null
        val text = clean(json.optString("text"), MAX_TRANSCRIPT_CHARS)
        if (text.isEmpty()) return null
        return Transcript(
            requestId = requestId,
            text = text,
            threadId = json.optString("threadId").takeIf(::isSafeId),
            revised = json.optBoolean("revised", false),
        )
    }

    fun decodeChatSnapshot(json: JSONObject): ChatSnapshot? {
        if (json.optInt("version") != 1 || json.optString("kind") != "chat.snapshot") return null
        val threadId = json.optString("threadId").takeIf(::isSafeId) ?: return null
        val paragraphsJson = json.optJSONArray("paragraphs") ?: JSONArray()
        val paragraphs = buildList {
            for (index in 0 until minOf(paragraphsJson.length(), 5)) {
                val item = paragraphsJson.optJSONObject(index) ?: continue
                val id = item.optString("id").takeIf(::isSafeId) ?: continue
                val text = cleanChatText(item.optString("text"), MAX_CHAT_MESSAGE_CHARS)
                if (text.isEmpty()) continue
                val phase = when (item.optString("phase")) {
                    "commentary" -> ChatPhase.COMMENTARY
                    "final_answer" -> ChatPhase.FINAL_ANSWER
                    else -> ChatPhase.UNKNOWN
                }
                add(ChatParagraph(id, text, phase))
            }
        }
        val messagesJson = json.optJSONArray("messages")
        val messages = if (messagesJson == null) {
            paragraphs.map { paragraph ->
                ChatMessage(
                    id = paragraph.id,
                    turnId = paragraph.id,
                    role = ChatRole.ASSISTANT,
                    text = paragraph.text,
                    phase = paragraph.phase,
                )
            }
        } else {
            decodeChatMessages(messagesJson)
        }
        val status = when (json.optString("status")) {
            "active" -> SessionStatus.ACTIVE
            "idle" -> SessionStatus.IDLE
            "error" -> SessionStatus.ERROR
            else -> SessionStatus.NOT_LOADED
        }
        return ChatSnapshot(
            threadId = threadId,
            title = clean(json.optString("title"), 100).ifEmpty { "Codex session" },
            status = status,
            paragraphs = paragraphs,
            generatedAtMillis = json.optLong("generatedAt", System.currentTimeMillis()),
            requestId = json.optString("requestId").takeIf(::isSafeId),
            messages = messages,
        )
    }

    fun chatSnapshotToJson(snapshot: ChatSnapshot): String = JSONObject()
        .put("threadId", snapshot.threadId)
        .put("title", snapshot.title)
        .put("status", snapshot.status.name)
        .put("generatedAt", snapshot.generatedAtMillis)
        .put("requestId", snapshot.requestId)
        .put(
            "paragraphs",
            JSONArray().apply {
                snapshot.paragraphs.takeLast(5).forEach { paragraph ->
                    put(
                        JSONObject()
                            .put("id", paragraph.id)
                            .put("text", paragraph.text)
                            .put("phase", paragraph.phase.name),
                    )
                }
            },
        )
        .put(
            "messages",
            JSONArray().apply {
                snapshot.messages.takeLast(MAX_CHAT_MESSAGES).forEach { message ->
                    put(
                        JSONObject()
                            .put("id", message.id)
                            .put("turnId", message.turnId)
                            .put("role", message.role.name)
                            .put("kind", message.kind.name)
                            .put("text", message.text)
                            .put("phase", message.phase.name)
                            .put("approvalId", message.approvalId)
                            .put("canControl", message.canControl)
                            .put("resolved", message.resolved),
                    )
                }
            },
        )
        .toString()

    fun chatSnapshotFromJson(value: String): ChatSnapshot? = runCatching {
        val json = JSONObject(value)
        val threadId = json.getString("threadId")
        val paragraphsJson = json.optJSONArray("paragraphs") ?: JSONArray()
        val paragraphs = buildList {
            for (index in 0 until minOf(paragraphsJson.length(), 5)) {
                val item = paragraphsJson.getJSONObject(index)
                add(
                    ChatParagraph(
                        id = item.getString("id"),
                        text = cleanChatText(item.getString("text"), MAX_CHAT_MESSAGE_CHARS),
                        phase = runCatching { ChatPhase.valueOf(item.getString("phase")) }.getOrDefault(ChatPhase.UNKNOWN),
                    ),
                )
            }
        }
        ChatSnapshot(
            threadId = threadId,
            title = clean(json.getString("title"), 100),
            status = runCatching { SessionStatus.valueOf(json.getString("status")) }.getOrDefault(SessionStatus.NOT_LOADED),
            paragraphs = paragraphs,
            generatedAtMillis = json.optLong("generatedAt"),
            requestId = json.optString("requestId").takeIf(::isSafeId),
            messages = json.optJSONArray("messages")?.let(::decodeStoredChatMessages)
                ?: paragraphs.map { paragraph ->
                    ChatMessage(
                        id = paragraph.id,
                        turnId = paragraph.id,
                        role = ChatRole.ASSISTANT,
                        text = paragraph.text,
                        phase = paragraph.phase,
                    )
                },
        )
    }.getOrNull()

    fun sessionsToJson(sessions: List<AgentSession>): String = JSONArray().apply {
        sessions.take(50).forEach { session ->
            put(
                JSONObject()
                    .put("id", session.id)
                    .put("title", session.title)
                    .put("updatedAt", session.updatedAtMillis)
                    .put("status", session.status.name)
                    .put("ownedByWear", session.ownedByWear)
                    .put("canAcceptDirectInput", session.canAcceptDirectInput),
            )
        }
    }.toString()

    fun modelsToJson(models: List<ModelOption>): String = JSONArray().apply {
        models.take(50).forEach { model ->
            put(
                JSONObject()
                    .put("id", model.id)
                    .put("displayName", model.displayName)
                    .put("model", model.model)
                    .put("defaultReasoningEffort", model.defaultReasoningEffort)
                    .put("supportedReasoningEfforts", JSONArray(model.supportedReasoningEfforts.take(8))),
            )
        }
    }.toString()

    fun modelsFromJson(value: String): List<ModelOption> = runCatching {
        val data = JSONArray(value)
        buildList {
            for (index in 0 until minOf(data.length(), 50)) {
                val item = data.optJSONObject(index) ?: continue
                val model = item.optString("model").takeIf(::isSafeModelValue) ?: continue
                val id = item.optString("id").takeIf(::isSafeModelValue) ?: model
                val displayName = clean(item.optString("displayName"), 80).ifEmpty { model }
                val efforts = item.optJSONArray("supportedReasoningEfforts")
                    ?.let { effortArray ->
                        buildList {
                            for (effortIndex in 0 until minOf(effortArray.length(), 8)) {
                                effortArray.optString(effortIndex)
                                    .takeIf(ReasoningEffortPolicy::isSafeValue)
                                    ?.let { add(ReasoningEffortPolicy.normalize(it)) }
                            }
                        }
                    }
                    ?.distinct()
                    .orEmpty()
                val supportedEfforts = if (efforts.isEmpty()) ReasoningEffortPolicy.FALLBACK_OPTIONS else efforts
                val defaultEffort = ReasoningEffortPolicy.normalize(item.optString("defaultReasoningEffort"))
                    .takeIf(supportedEfforts::contains)
                    ?: supportedEfforts.first()
                add(ModelOption(id, displayName, model, defaultEffort, supportedEfforts))
            }
        }.distinctBy { it.model }
    }.getOrDefault(emptyList())

    fun sessionsFromJson(value: String): List<AgentSession> = runCatching {
        val data = JSONArray(value)
        buildList {
            for (index in 0 until minOf(data.length(), 50)) {
                val item = data.optJSONObject(index) ?: continue
                val id = item.optString("id").takeIf(::isSafeId) ?: continue
                add(
                    AgentSession(
                        id = id,
                        title = clean(item.optString("title"), 100),
                        updatedAtMillis = item.optLong("updatedAt"),
                        status = runCatching { SessionStatus.valueOf(item.optString("status")) }
                            .getOrDefault(SessionStatus.NOT_LOADED),
                        ownedByWear = item.optBoolean("ownedByWear"),
                        canAcceptDirectInput = item.optBoolean("canAcceptDirectInput"),
                    ),
                )
            }
        }
    }.getOrDefault(emptyList())

    fun alertToJson(alert: AgentAlert): String = JSONObject()
        .put("eventId", alert.eventId)
        .put("kind", alert.kind.name)
        .put("threadId", alert.threadId)
        .put("title", alert.title)
        .put("detail", alert.detail)
        .put("occurredAt", alert.occurredAtMillis)
        .put("approvalId", alert.approvalId)
        .put("canControl", alert.canControl)
        .toString()

    fun alertsToJson(alerts: List<AgentAlert>): String = JSONArray().apply {
        alerts.takeLast(20).forEach { put(JSONObject(alertToJson(it))) }
    }.toString()

    fun alertsFromJson(value: String): List<AgentAlert> = runCatching {
        val data = JSONArray(value)
        buildList {
            for (index in 0 until minOf(data.length(), 20)) {
                data.optJSONObject(index)?.let { item -> alertFromJson(item.toString())?.let(::add) }
            }
        }
    }.getOrDefault(emptyList())

    fun alertFromJson(value: String): AgentAlert? = runCatching {
        val item = JSONObject(value)
        AgentAlert(
            eventId = item.getString("eventId"),
            kind = AlertKind.valueOf(item.getString("kind")),
            threadId = item.getString("threadId"),
            title = clean(item.getString("title"), 100),
            detail = fullAlertDetail(item.getString("detail")),
            occurredAtMillis = item.getLong("occurredAt"),
            approvalId = item.optString("approvalId").takeIf(::isSafeId),
            canControl = item.optBoolean("canControl"),
        )
    }.getOrNull()

    private fun decodeChatMessages(data: JSONArray): List<ChatMessage> = buildList {
        for (index in 0 until minOf(data.length(), MAX_CHAT_MESSAGES)) {
            val item = data.optJSONObject(index) ?: continue
            val id = item.optString("id").takeIf(::isSafeId) ?: continue
            val turnId = item.optString("turnId").takeIf(::isSafeId) ?: continue
            val role = when (item.optString("role")) {
                "user" -> ChatRole.USER
                "assistant" -> ChatRole.ASSISTANT
                else -> continue
            }
            val text = cleanChatText(item.optString("text"), MAX_CHAT_MESSAGE_CHARS)
            if (text.isEmpty()) continue
            val phase = when (item.optString("phase")) {
                "commentary" -> ChatPhase.COMMENTARY
                "final_answer" -> ChatPhase.FINAL_ANSWER
                else -> ChatPhase.UNKNOWN
            }
            val kind = when (item.optString("kind")) {
                "permission" -> ChatMessageKind.PERMISSION
                else -> ChatMessageKind.MESSAGE
            }
            add(
                ChatMessage(
                    id = id,
                    turnId = turnId,
                    role = role,
                    text = text,
                    phase = phase,
                    kind = kind,
                    approvalId = item.optString("approvalId").takeIf(::isSafeId),
                    canControl = item.optBoolean("canControl", false),
                    resolved = item.optBoolean("resolved", false),
                ),
            )
        }
    }

    private fun decodeStoredChatMessages(data: JSONArray): List<ChatMessage> = buildList {
        for (index in 0 until minOf(data.length(), MAX_CHAT_MESSAGES)) {
            val item = data.optJSONObject(index) ?: continue
            val id = item.optString("id").takeIf(::isSafeId) ?: continue
            val turnId = item.optString("turnId").takeIf(::isSafeId) ?: continue
            val role = runCatching { ChatRole.valueOf(item.optString("role")) }.getOrNull() ?: continue
            val text = cleanChatText(item.optString("text"), MAX_CHAT_MESSAGE_CHARS)
            if (text.isEmpty()) continue
            val phase = runCatching { ChatPhase.valueOf(item.optString("phase")) }.getOrDefault(ChatPhase.UNKNOWN)
            val kind = runCatching { ChatMessageKind.valueOf(item.optString("kind")) }
                .getOrDefault(ChatMessageKind.MESSAGE)
            add(
                ChatMessage(
                    id = id,
                    turnId = turnId,
                    role = role,
                    text = text,
                    phase = phase,
                    kind = kind,
                    approvalId = item.optString("approvalId").takeIf(::isSafeId),
                    canControl = item.optBoolean("canControl", false),
                    resolved = item.optBoolean("resolved", false),
                ),
            )
        }
    }

    private fun clean(value: String, limit: Int): String = cleanFullText(value).take(limit)

    private fun cleanFullText(value: String): String = fullAlertDetail(value)

    private fun cleanChatText(value: String, limit: Int): String = value
        .replace("\r\n", "\n")
        .replace('\r', '\n')
        .trim()
        .take(limit)

    private fun isSafeId(value: String): Boolean = value.length in 1..128 &&
        value.all { it.isLetterOrDigit() || it in "-_.:" }

    private fun isSafeModelValue(value: String): Boolean = value.length in 1..128 &&
        value.all { it.isLetterOrDigit() || it in "-_.:/" }

    private const val MAX_CHAT_MESSAGES = 12
    private const val MAX_CHAT_MESSAGE_CHARS = 6_000
}

internal fun fullAlertDetail(value: String): String = value.trim().replace(Regex("\\s+"), " ")

internal fun acceptsAlertEnvelope(kind: String, turnScope: String): Boolean = when (kind) {
    "terminal.completed", "terminal.failed", "terminal.interrupted", "terminal.blocked" ->
        turnScope == "topLevel"
    "approval.request" -> true
    else -> false
}

internal fun isRequestErrorKind(kind: String): Boolean = kind in setOf(
    "transcription.error",
    "turn.error",
    "approval.error",
    "bridge.error",
)
