package io.github.sirbughunter.agenticwear.data

import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AgentSession
import io.github.sirbughunter.agenticwear.model.CloudModelInfo
import io.github.sirbughunter.agenticwear.model.AlertKind
import io.github.sirbughunter.agenticwear.model.BridgePayload
import io.github.sirbughunter.agenticwear.model.ChatParagraph
import io.github.sirbughunter.agenticwear.model.ChatPhase
import io.github.sirbughunter.agenticwear.model.ChatQuestion
import io.github.sirbughunter.agenticwear.model.MAX_QUESTION_OPTIONS
import io.github.sirbughunter.agenticwear.model.ChatMessage
import io.github.sirbughunter.agenticwear.model.ChatMessageKind
import io.github.sirbughunter.agenticwear.model.ChatRole
import io.github.sirbughunter.agenticwear.model.ChatSnapshot
import io.github.sirbughunter.agenticwear.model.FeedbackRating
import io.github.sirbughunter.agenticwear.model.FollowUpAction
import io.github.sirbughunter.agenticwear.model.MAX_TRANSCRIPT_CHARS
import io.github.sirbughunter.agenticwear.model.MAX_LOCAL_SESSION_SNAPSHOT
import io.github.sirbughunter.agenticwear.model.ModelOption
import io.github.sirbughunter.agenticwear.model.ReasoningEffortPolicy
import io.github.sirbughunter.agenticwear.model.SessionStatus
import io.github.sirbughunter.agenticwear.model.Transcript
import io.github.sirbughunter.agenticwear.notification.MAX_NOTIFY_TRACE_ALERTS
import io.github.sirbughunter.agenticwear.notification.NotifyTrace
import org.json.JSONArray
import org.json.JSONObject

object PayloadCodec {
    fun encode(payload: BridgePayload): String = when (payload) {
        is BridgePayload.SessionSync -> JSONObject()
            .put("version", 1)
            .put("kind", "session.sync")
            .put("requestId", payload.requestId)
            .toString()
        is BridgePayload.PrepareDraft -> JSONObject().put("version", 1).put("kind", "draft.prepare").put("requestId", payload.requestId).toString()
        is BridgePayload.CreateTranscription -> JSONObject()
            .put("version", 1)
            .put("kind", "transcription.create")
            .put("requestId", payload.requestId)
            .put("audioBase64", payload.audioBase64)
            .put("mimeType", payload.mimeType)
            .put("threadId", payload.threadId)
            .put("previousText", payload.previousText)
            .apply { if (payload.finalIntent) put("finalIntent", true); if (payload.localEdit) put("localEdit", true) }
            .apply { payload.backend?.let { put("backend", it) } }
            .toString()
        is BridgePayload.SubmitTurn -> JSONObject()
            .put("version", 1)
            .put("kind", "turn.submit")
            .put("requestId", payload.requestId)
            .put("threadId", payload.threadId)
            .put("text", payload.text)
            .put("effort", ReasoningEffortPolicy.normalize(payload.effort))
            .apply { payload.model?.takeIf { if (payload.cloudModel) isSafeCloudLabel(it) else isSafeModelValue(it) }?.let { put("model", it) } }
            .apply { payload.cloudEffortIndex?.takeIf { it in 0..9 }?.let { put("cloudEffortIndex", it) } }
            .apply { payload.followUpAction.wireOverride()?.let { put("followUpAction", it) } }
            .toString()
        is BridgePayload.AnswerQuestion -> JSONObject()
            .put("version", 1)
            .put("kind", "question.answer")
            .put("requestId", payload.requestId)
            .put("threadId", payload.threadId)
            .put("questionItemId", payload.questionItemId)
            .put("questionIndex", payload.questionIndex.coerceIn(0, MAX_QUESTION_INDEX))
            .put("answer", payload.answer.trim().take(MAX_TRANSCRIPT_CHARS))
            .apply { payload.question?.trim()?.takeIf(String::isNotEmpty)?.let { put("question", it.take(MAX_QUESTION_FALLBACK_CHARS)) } }
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

    /**
     * Metadata-only notification timing for the bridge (`notify.trace`): epoch milliseconds on the
     * Watch clock plus per-alert decisions. Never carries titles, details or message text.
     */
    /** Value-free voice loop trace (`voice.loop.trace`): phase and reason names plus epoch ms. No audio or text. */
    internal fun encodeVoiceLoopTrace(requestId: String, phase: String, reason: String?, at: Long): String = JSONObject()
        .put("version", 1)
        .put("kind", "voice.loop.trace")
        .put("requestId", requestId)
        .put("phase", phase)
        .apply { if (reason != null) put("reason", reason) }
        .put("at", at)
        .toString()

    internal fun encodeNotifyTrace(requestId: String, trace: NotifyTrace): String = JSONObject()
        .put("version", 1)
        .put("kind", "notify.trace")
        .put("requestId", requestId)
        .put("pushReceivedAt", trace.pushReceivedAtMillis)
        .put("fetchStartedAt", trace.fetchStartedAtMillis)
        .put("fetchCompletedAt", trace.fetchCompletedAtMillis)
        .put("fetchAttempt", trace.fetchAttempt.coerceIn(1, MAX_NOTIFY_TRACE_FETCH_ATTEMPT))
        .put("deliveredVia", trace.deliveredVia)
        .put(
            "alerts",
            JSONArray().apply {
                trace.alerts.take(MAX_NOTIFY_TRACE_ALERTS).forEach { alert ->
                    put(
                        JSONObject()
                            .put("eventId", alert.eventId)
                            .put("decision", alert.decision.wire)
                            .put("decidedAt", alert.decidedAtMillis),
                    )
                }
            },
        )
        .toString()

    /**
     * Metadata-only relay failure report for the bridge (`relay.failures`): the operation name, HTTP
     * status (0 = no response), exception class name and Watch epoch milliseconds of each failed
     * attempt. Never a message, URL, id, token or error text. Values are clamped to what the
     * bridge schema accepts so one odd entry cannot get the whole report rejected.
     */
    internal fun encodeRelayFailures(requestId: String, failures: List<RelayFailure>): String = JSONObject()
        .put("version", 1)
        .put("kind", "relay.failures")
        .put("requestId", requestId)
        .put(
            "failures",
            JSONArray().apply {
                failures.takeLast(RelayFailureLog.MAX_ENTRIES).forEach { failure ->
                    put(
                        JSONObject()
                            .put("op", failure.op)
                            .put("status", failure.status.coerceIn(0, MAX_RELAY_FAILURE_STATUS))
                            .put("errorClass", safeErrorClass(failure.errorClass))
                            .put("at", failure.at.coerceAtLeast(0L)),
                    )
                }
            },
        )
        .toString()

    internal fun encodePushDiagnostics(requestId: String, pushes: List<PushRecord>): String = JSONObject()
        .put("version", 1)
        .put("kind", "push.diagnostics")
        .put("requestId", requestId)
        .put(
            "pushes",
            JSONArray().apply {
                pushes.takeLast(PushDiagnostics.MAX_ENTRIES).forEach { push ->
                    put(
                        JSONObject()
                            .put("receivedAt", push.receivedAt.coerceAtLeast(0L))
                            .put("sentTime", push.sentTime.coerceAtLeast(0L))
                            .put("priority", push.priority.coerceIn(0, 2))
                            .put("originalPriority", push.originalPriority.coerceIn(0, 2))
                            .put("envelopePresent", push.envelopePresent)
                            .put("envelopeChars", push.envelopeChars.coerceIn(0, 10_000))
                            .put("outcome", push.outcome)
                            .put("outcomeAt", push.outcomeAt.coerceAtLeast(0L)),
                    )
                }
            },
        )
        .toString()

    private fun safeErrorClass(value: String): String {
        val safe = value.filter { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '_' || it == '.' || it == '$' }
            .take(MAX_ERROR_CLASS_CHARS)
        return safe.ifEmpty { "Unknown" }
    }

    fun decodeSessions(json: JSONObject): List<AgentSession> {
        if (json.optInt("version") != 1 || json.optString("kind") != "sessions.snapshot") return emptyList()
        val data = json.optJSONArray("sessions") ?: return emptyList()
        return buildList {
            for (index in 0 until minOf(data.length(), MAX_LOCAL_SESSION_SNAPSHOT)) {
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
                        watchReady = value.optBoolean("watchReady", false),
                        pinned = value.optBoolean("pinned", false),
                        source = value.optString("source").takeIf { it in KNOWN_SESSION_SOURCES },
                        attention = value.optString("attention").takeIf { it == "question" || it == "approval" },
                        cloud = decodeCloudInfo(value),
                    ),
                )
            }
        }
    }

    /** Reads cloudModel/cloudModels/cloudEffort/cloudEfforts; null when no model list was reported. */
    fun decodeCloudInfo(json: JSONObject): CloudModelInfo? {
        val models = json.optJSONArray("cloudModels")?.let { array ->
            (0 until minOf(array.length(), MAX_CLOUD_OPTIONS)).mapNotNull { array.optString(it).trim().takeIf(::isSafeCloudLabel) }.distinct()
        }.orEmpty()
        if (models.isEmpty()) return null
        val efforts = json.optJSONArray("cloudEfforts")?.let { array ->
            (0 until minOf(array.length(), MAX_CLOUD_OPTIONS)).map { index ->
                array.optString(index).trim().takeIf(::isSafeCloudLabel) ?: "Level ${index + 1}"
            }
        }.orEmpty()
        val effort = json.optJSONObject("cloudEffort")
        return CloudModelInfo(
            model = json.optString("cloudModel").trim().takeIf(::isSafeCloudLabel),
            models = models,
            effortIndex = effort?.takeIf { it.has("index") }?.optInt("index", -1)?.takeIf { it in 0 until MAX_CLOUD_OPTIONS },
            effortLabel = effort?.optString("label")?.trim()?.takeIf(::isSafeCloudLabel),
            efforts = efforts,
        )
    }

    private fun putCloudInfo(target: JSONObject, info: CloudModelInfo?) {
        if (info == null) return
        info.model?.let { target.put("cloudModel", it) }
        target.put("cloudModels", JSONArray(info.models))
        if (info.effortIndex != null) target.put("cloudEffort", JSONObject().put("index", info.effortIndex).put("label", info.effortLabel ?: ""))
        target.put("cloudEfforts", JSONArray(info.efforts))
    }

    private fun isSafeCloudLabel(value: String): Boolean = value.length in 1..64 && value.none { it.isISOControl() }

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
            "question.request" -> AlertKind.QUESTION
            else -> return null
        }
        val eventId = json.optString("eventId").takeIf(::isSafeId) ?: return null
        val threadId = json.optString("threadId").takeIf(::isSafeId) ?: return null
        val title = clean(json.optString("title"), 100).ifEmpty { "Agent session" }
        val detail = alertDetailFor(kind, json.optString("detail")).ifEmpty {
            when (kind) {
                AlertKind.COMPLETE -> "The agent finished its work."
                AlertKind.PERMISSION -> "The agent needs your decision."
                AlertKind.ERROR -> "The agent stopped before completing its work."
                AlertKind.QUESTION -> "The agent has a question for you."
            }
        }
        val options = if (kind == AlertKind.QUESTION) {
            decodeQuestionOptions(json.optJSONArray("options"), MAX_QUESTION_OPTIONS, MAX_QUESTION_OPTION_CHARS)
        } else emptyList()
        return AgentAlert(
            eventId = eventId,
            kind = kind,
            threadId = threadId,
            title = title,
            detail = detail,
            occurredAtMillis = json.optLong("occurredAt", System.currentTimeMillis()),
            approvalId = json.optString("approvalId").takeIf(::isSafeId),
            canControl = json.optBoolean("canControl", false),
            options = options,
            questionItemId = if (kind == AlertKind.QUESTION) json.optString("questionItemId").takeIf(::isSafeId) else null,
            questionIndex = json.optInt("questionIndex", 0).coerceIn(0, MAX_QUESTION_INDEX),
        )
    }

    /** True when a `terminal.completed` payload says its final answer already raised a question alert. */
    fun hasQuestion(json: JSONObject): Boolean =
        json.optString("kind") == "terminal.completed" && json.optBoolean("hasQuestion", false)

    private fun decodeQuestionOptions(array: JSONArray?, maxOptions: Int, maxChars: Int): List<String> {
        if (array == null) return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val value = array.optString(index, "").trim()
                if (value.isEmpty() || contains(value)) continue
                add(value.take(maxChars))
                if (size >= maxOptions) break
            }
        }
    }

    private fun decodeChatQuestions(array: JSONArray?): List<ChatQuestion> {
        if (array == null) return emptyList()
        return buildList {
            for (index in 0 until minOf(array.length(), MAX_CHAT_QUESTIONS)) {
                val item = array.optJSONObject(index) ?: continue
                val title = item.optString("title").trim().take(MAX_QUESTION_TITLE_CHARS)
                if (title.isEmpty()) continue
                add(ChatQuestion(title, decodeQuestionOptions(item.optJSONArray("options"), MAX_CHAT_QUESTION_OPTIONS, MAX_CHAT_OPTION_CHARS)))
            }
        }
    }

    private fun chatQuestionsToJson(questions: List<ChatQuestion>): JSONArray = JSONArray().apply {
        questions.take(MAX_CHAT_QUESTIONS).forEach { q ->
            put(JSONObject().put("title", q.title).put("options", JSONArray(q.options)))
        }
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
            editNotice = clean(json.optString("editNotice"), 240).takeIf { it.isNotEmpty() },
            editChoices = (json.optJSONArray("editChoices") ?: JSONArray()).let { choices ->
                (0 until minOf(choices.length(), 5)).mapNotNull { i -> clean(choices.optString(i), MAX_TRANSCRIPT_CHARS).takeIf { it.isNotEmpty() } }
            },
            rawText = if (json.has("rawText")) clean(json.optString("rawText"), MAX_TRANSCRIPT_CHARS).takeIf { it.isNotEmpty() } else null,
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
            partial = json.optBoolean("partial", false),
            cloud = decodeCloudInfo(json),
        )
    }

    fun chatSnapshotToJson(snapshot: ChatSnapshot): String = JSONObject()
        .put("threadId", snapshot.threadId)
        .put("title", snapshot.title)
        .put("status", snapshot.status.name)
        .put("generatedAt", snapshot.generatedAtMillis)
        .put("requestId", snapshot.requestId)
        .also { putCloudInfo(it, snapshot.cloud) }
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
                            .put("resolved", message.resolved)
                            .put("watchRequestId", message.watchRequestId)
                            .apply {
                                if (message.questions.isNotEmpty()) put("questions", chatQuestionsToJson(message.questions))
                                message.questionItemId?.let { put("questionItemId", it) }
                                if (message.answered) put("answered", true)
                            },
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
        sessions.take(MAX_LOCAL_SESSION_SNAPSHOT).forEach { session ->
            put(
                JSONObject()
                    .put("id", session.id)
                    .put("title", session.title)
                    .put("updatedAt", session.updatedAtMillis)
                    .put("status", session.status.name)
                    .put("ownedByWear", session.ownedByWear)
                    .put("canAcceptDirectInput", session.canAcceptDirectInput)
                    .put("watchReady", session.watchReady)
                    .put("pinned", session.pinned)
                    .put("source", session.source)
                    .put("attention", session.attention)
                    .also { putCloudInfo(it, session.cloud) },
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
            for (index in 0 until minOf(data.length(), MAX_LOCAL_SESSION_SNAPSHOT)) {
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
                        watchReady = item.optBoolean("watchReady"),
                        pinned = item.optBoolean("pinned"),
                        source = item.optString("source").takeIf { !item.isNull("source") && it in KNOWN_SESSION_SOURCES },
                        attention = item.optString("attention").takeIf { !item.isNull("attention") && (it == "question" || it == "approval") },
                        cloud = decodeCloudInfo(item),
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
        .apply {
            if (alert.options.isNotEmpty()) put("options", JSONArray(alert.options))
            alert.questionItemId?.let { put("questionItemId", it) }
            if (alert.questionIndex != 0) put("questionIndex", alert.questionIndex)
        }
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
            detail = alertDetailFor(AlertKind.valueOf(item.getString("kind")), item.getString("detail")),
            occurredAtMillis = item.getLong("occurredAt"),
            approvalId = item.optString("approvalId").takeIf(::isSafeId),
            canControl = item.optBoolean("canControl"),
            options = decodeQuestionOptions(item.optJSONArray("options"), MAX_QUESTION_OPTIONS, MAX_QUESTION_OPTION_CHARS),
            questionItemId = item.optString("questionItemId").takeIf(::isSafeId),
            questionIndex = item.optInt("questionIndex", 0).coerceIn(0, MAX_QUESTION_INDEX),
        )
    }.getOrNull()

    private fun decodeChatMessages(data: JSONArray): List<ChatMessage> = buildList {
        for (index in maxOf(0, data.length() - MAX_CHAT_MESSAGES) until data.length()) {
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
                    watchRequestId = item.optString("watchRequestId").takeIf(::isSafeId),
                    questions = if (role == ChatRole.ASSISTANT) decodeChatQuestions(item.optJSONArray("questions")) else emptyList(),
                    questionItemId = item.optString("questionItemId").takeIf(::isSafeId),
                    answered = item.optBoolean("answered", false),
                ),
            )
        }
    }

    private fun decodeStoredChatMessages(data: JSONArray): List<ChatMessage> = buildList {
        for (index in maxOf(0, data.length() - MAX_CHAT_MESSAGES) until data.length()) {
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
                    watchRequestId = item.optString("watchRequestId").takeIf(::isSafeId),
                    questions = if (role == ChatRole.ASSISTANT) decodeChatQuestions(item.optJSONArray("questions")) else emptyList(),
                    questionItemId = item.optString("questionItemId").takeIf(::isSafeId),
                    answered = item.optBoolean("answered", false),
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

    private const val MAX_NOTIFY_TRACE_FETCH_ATTEMPT = 10
    private const val MAX_RELAY_FAILURE_STATUS = 599
    private const val MAX_ERROR_CLASS_CHARS = 80
    private const val MAX_CHAT_MESSAGES = 12
    private const val MAX_CLOUD_OPTIONS = 16
    private val KNOWN_SESSION_SOURCES = setOf("cloud", "dot", "automation")
    private const val MAX_CHAT_MESSAGE_CHARS = 6_000
    private const val MAX_QUESTION_INDEX = 9
    private const val MAX_QUESTION_FALLBACK_CHARS = 1_000
    private const val MAX_QUESTION_OPTION_CHARS = 40
    private const val MAX_CHAT_QUESTIONS = 3
    private const val MAX_CHAT_QUESTION_OPTIONS = 6
    private const val MAX_QUESTION_TITLE_CHARS = 600
    private const val MAX_CHAT_OPTION_CHARS = 120
}

internal fun FollowUpAction.wireOverride(): String? =
    wireValue.takeUnless { this == FollowUpAction.DEFAULT }

/** Replies and questions keep their line breaks so the notification can render markdown blocks. */
internal fun alertDetailFor(kind: AlertKind, value: String): String =
    if (kind == AlertKind.COMPLETE || kind == AlertKind.QUESTION) multilineAlertDetail(value) else fullAlertDetail(value)

internal fun multilineAlertDetail(value: String): String = value
    .replace("\r\n", "\n")
    .replace('\r', '\n')
    .lines()
    .joinToString("\n") { it.replace(Regex("[ \\t]+"), " ").trim() }
    .replace(Regex("\n{3,}"), "\n\n")
    .trim()

internal fun fullAlertDetail(value: String): String = value.trim().replace(Regex("\\s+"), " ")

internal fun acceptsAlertEnvelope(kind: String, turnScope: String): Boolean = when (kind) {
    "terminal.completed", "terminal.failed", "terminal.interrupted", "terminal.blocked" ->
        turnScope == "topLevel"
    "approval.request", "question.request" -> true
    else -> false
}

internal fun isRequestErrorKind(kind: String): Boolean = kind in setOf(
    "transcription.error",
    "turn.error",
    "approval.error",
    "bridge.error",
)
