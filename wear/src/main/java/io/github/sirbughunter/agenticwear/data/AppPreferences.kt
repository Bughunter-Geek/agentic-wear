package io.github.sirbughunter.agenticwear.data

import android.content.Context
import androidx.core.content.edit
import io.github.sirbughunter.agenticwear.BuildConfig
import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AgentSession
import io.github.sirbughunter.agenticwear.model.ApprovalMode
import io.github.sirbughunter.agenticwear.model.ChatSnapshot
import io.github.sirbughunter.agenticwear.model.FeedbackRating
import io.github.sirbughunter.agenticwear.model.ModelOption
import io.github.sirbughunter.agenticwear.model.ReasoningEffortPolicy
import io.github.sirbughunter.agenticwear.model.Transcript
import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import org.json.JSONArray
import org.json.JSONObject

class AppPreferences(context: Context) {
    private val prefs = context.getSharedPreferences("agentic_wear_state", Context.MODE_PRIVATE)

    var relayUrl: String
        get() = prefs.getString(KEY_RELAY_URL, null).orEmpty().ifEmpty { BuildConfig.DEFAULT_RELAY_URL }
        set(value) = prefs.edit { putString(KEY_RELAY_URL, RelayUrlPolicy.normalize(value)) }

    var selectedThreadId: String?
        get() = prefs.getString(KEY_SELECTED_THREAD, null)
        set(value) = prefs.edit { putString(KEY_SELECTED_THREAD, value) }

    var submitDraftAsNewSession: Boolean
        get() = prefs.getBoolean(KEY_SUBMIT_DRAFT_AS_NEW_SESSION, false)
        set(value) = prefs.edit { putBoolean(KEY_SUBMIT_DRAFT_AS_NEW_SESSION, value) }

    var transcriptionEngine: TranscriptionEngine
        get() = storedTranscriptionEngine(prefs.getString(KEY_ENGINE, null))
        set(value) = prefs.edit { putString(KEY_ENGINE, value.name) }

    var approvalMode: ApprovalMode
        get() = enumValue(prefs.getString(KEY_APPROVAL_MODE, null), ApprovalMode.ALERT_ONLY)
        set(value) = prefs.edit { putString(KEY_APPROVAL_MODE, value.name) }

    var collapseUpdates: Boolean
        get() = prefs.getBoolean(KEY_COLLAPSE_UPDATES, true)
        set(value) = prefs.edit { putBoolean(KEY_COLLAPSE_UPDATES, value) }

    /** Null means use the model selected by Codex on the bridge. */
    var selectedModel: String?
        get() = prefs.getString(KEY_MODEL, null)?.takeIf(::isSafeModel)
        set(value) = prefs.edit {
            if (value.isNullOrBlank()) remove(KEY_MODEL) else putString(KEY_MODEL, value.takeIf(::isSafeModel))
        }

    var reasoningEffort: String
        get() = ReasoningEffortPolicy.normalize(prefs.getString(KEY_REASONING_EFFORT, null))
        set(value) = prefs.edit { putString(KEY_REASONING_EFFORT, ReasoningEffortPolicy.normalize(value)) }

    var sessions: List<AgentSession>
        get() = PayloadCodec.sessionsFromJson(prefs.getString(KEY_SESSIONS, "[]").orEmpty())
        set(value) = prefs.edit { putString(KEY_SESSIONS, PayloadCodec.sessionsToJson(value)) }

    var models: List<ModelOption>
        get() = PayloadCodec.modelsFromJson(prefs.getString(KEY_MODELS, "[]").orEmpty())
        set(value) = prefs.edit { putString(KEY_MODELS, PayloadCodec.modelsToJson(value)) }

    var latestAlert: AgentAlert?
        get() = alertHistory().lastOrNull() ?: prefs.getString(KEY_ALERT, null)?.let(PayloadCodec::alertFromJson)
        set(value) {
            if (value == null) {
                prefs.edit { remove(KEY_ALERTS).remove(KEY_ALERT) }
            } else {
                val alerts = (alertHistory().filterNot { it.eventId == value.eventId } + value).takeLast(20)
                prefs.edit {
                    putString(KEY_ALERTS, PayloadCodec.alertsToJson(alerts))
                    remove(KEY_ALERT)
                }
            }
        }

    fun alert(eventId: String): AgentAlert? = alertHistory().firstOrNull { it.eventId == eventId }

    var transcript: Transcript?
        get() = prefs.getString(KEY_TRANSCRIPT, null)?.let(::decodeTranscript)
        set(value) = prefs.edit {
            putString(KEY_TRANSCRIPT, value?.let(::encodeTranscript))
        }

    var revisionBase: Transcript?
        get() = prefs.getString(KEY_REVISION_BASE, null)?.let(::decodeTranscript)
        set(value) = prefs.edit { putString(KEY_REVISION_BASE, value?.let(::encodeTranscript)) }

    var chatSnapshot: ChatSnapshot?
        get() = prefs.getString(KEY_CHAT_SNAPSHOT, null)?.let(PayloadCodec::chatSnapshotFromJson)
        set(value) = prefs.edit { putString(KEY_CHAT_SNAPSHOT, value?.let(PayloadCodec::chatSnapshotToJson)) }

    var chatFeedback: Map<String, FeedbackRating>
        get() = runCatching {
            val data = JSONArray(prefs.getString(KEY_CHAT_FEEDBACK, "[]").orEmpty())
            buildMap {
                for (index in 0 until minOf(data.length(), MAX_CHAT_FEEDBACK)) {
                    val item = data.optJSONObject(index) ?: continue
                    val itemId = item.optString("itemId").takeIf(::isSafeModel) ?: continue
                    val rating = runCatching { FeedbackRating.valueOf(item.optString("rating")) }.getOrNull()
                        ?: continue
                    put(itemId, rating)
                }
            }
        }.getOrDefault(emptyMap())
        set(value) = prefs.edit {
            val data = JSONArray()
            value.entries.toList().takeLast(MAX_CHAT_FEEDBACK).forEach { (itemId, rating) ->
                if (isSafeModel(itemId)) {
                    data.put(JSONObject().put("itemId", itemId).put("rating", rating.name))
                }
            }
            putString(KEY_CHAT_FEEDBACK, data.toString())
        }

    var pendingTurnRequestId: String?
        get() = prefs.getString(KEY_PENDING_TURN_REQUEST, null)
        set(value) = prefs.edit { putString(KEY_PENDING_TURN_REQUEST, value) }

    var pendingChatRequestId: String?
        get() = prefs.getString(KEY_PENDING_CHAT_REQUEST, null)
        set(value) = prefs.edit { putString(KEY_PENDING_CHAT_REQUEST, value) }

    var pendingFeedbackRequestId: String?
        get() = prefs.getString(KEY_PENDING_FEEDBACK_REQUEST, null)
        set(value) = prefs.edit { putString(KEY_PENDING_FEEDBACK_REQUEST, value) }

    var pendingApprovalRequestId: String?
        get() = prefs.getString(KEY_PENDING_APPROVAL_REQUEST, null)
        set(value) = prefs.edit { putString(KEY_PENDING_APPROVAL_REQUEST, value) }

    var lastAcceptedThreadId: String?
        get() = prefs.getString(KEY_LAST_ACCEPTED_THREAD, null)
        set(value) = prefs.edit { putString(KEY_LAST_ACCEPTED_THREAD, value) }

    var lastAcceptedTurnRequestId: String?
        get() = prefs.getString(KEY_LAST_ACCEPTED_TURN_REQUEST, null)
        set(value) = prefs.edit { putString(KEY_LAST_ACCEPTED_TURN_REQUEST, value) }

    var lastSendNotice: String?
        get() = prefs.getString(KEY_LAST_SEND_NOTICE, null)
        set(value) = prefs.edit { putString(KEY_LAST_SEND_NOTICE, value) }

    var pending: Boolean
        get() = prefs.getBoolean(KEY_PENDING, false)
        set(value) = prefs.edit { putBoolean(KEY_PENDING, value) }

    var lastError: String?
        get() = prefs.getString(KEY_LAST_ERROR, null)
        set(value) = prefs.edit { putString(KEY_LAST_ERROR, value) }

    fun markEventHandled(eventId: String): Boolean {
        return claimHandledEvent(
            eventId = eventId,
            read = { prefs.getString(KEY_HANDLED_IDS, null) },
            write = { ids -> prefs.edit(commit = true) { putString(KEY_HANDLED_IDS, ids) } },
        )
    }

    private inline fun <reified T : Enum<T>> enumValue(value: String?, fallback: T): T =
        value?.let { runCatching { enumValueOf<T>(it) }.getOrNull() } ?: fallback

    private fun alertHistory(): List<AgentAlert> = PayloadCodec.alertsFromJson(
        prefs.getString(KEY_ALERTS, "[]").orEmpty(),
    )

    private fun encodeTranscript(transcript: Transcript): String = JSONObject()
        .put("requestId", transcript.requestId)
        .put("text", transcript.text)
        .put("threadId", transcript.threadId)
        .put("revised", transcript.revised)
        .toString()

    private fun decodeTranscript(encoded: String): Transcript? = runCatching {
        val json = JSONObject(encoded)
        Transcript(
            requestId = json.getString("requestId"),
            text = json.getString("text"),
            threadId = json.optString("threadId").ifEmpty { null },
            revised = json.optBoolean("revised", false),
        )
    }.getOrNull()

    companion object {
        private const val KEY_RELAY_URL = "relay_url"
        private const val KEY_SELECTED_THREAD = "selected_thread"
        private const val KEY_SUBMIT_DRAFT_AS_NEW_SESSION = "submit_draft_as_new_session"
        private const val KEY_ENGINE = "transcription_engine"
        private const val KEY_APPROVAL_MODE = "approval_mode"
        private const val KEY_COLLAPSE_UPDATES = "collapse_updates"
        private const val KEY_MODEL = "model"
        private const val KEY_REASONING_EFFORT = "reasoning_effort"
        private const val KEY_SESSIONS = "sessions"
        private const val KEY_MODELS = "models"
        private const val KEY_ALERT = "latest_alert"
        private const val KEY_ALERTS = "recent_alerts"
        private const val KEY_TRANSCRIPT = "transcript"
        private const val KEY_REVISION_BASE = "revision_base"
        private const val KEY_CHAT_SNAPSHOT = "chat_snapshot"
        private const val KEY_CHAT_FEEDBACK = "chat_feedback"
        private const val KEY_PENDING_TURN_REQUEST = "pending_turn_request"
        private const val KEY_PENDING_CHAT_REQUEST = "pending_chat_request"
        private const val KEY_PENDING_FEEDBACK_REQUEST = "pending_feedback_request"
        private const val KEY_PENDING_APPROVAL_REQUEST = "pending_approval_request"
        private const val KEY_LAST_ACCEPTED_THREAD = "last_accepted_thread"
        private const val KEY_LAST_ACCEPTED_TURN_REQUEST = "last_accepted_turn_request"
        private const val KEY_LAST_SEND_NOTICE = "last_send_notice"
        private const val KEY_PENDING = "pending"
        private const val KEY_LAST_ERROR = "last_error"
        private const val KEY_HANDLED_IDS = "handled_ids"
        private const val MAX_CHAT_FEEDBACK = 100
    }
}

private fun isSafeModel(value: String): Boolean = value.length in 1..128 &&
    value.all { it.isLetterOrDigit() || it in "-_.:/" }

private val handledEventClaimLock = Any()

internal fun claimHandledEvent(
    eventId: String,
    read: () -> String?,
    write: (String) -> Unit,
): Boolean = synchronized(handledEventClaimLock) {
    val ids = read()
        .orEmpty()
        .split(',')
        .filter(String::isNotBlank)
        .toMutableList()
    if (eventId in ids) return@synchronized false
    ids += eventId
    write(ids.takeLast(100).joinToString(","))
    true
}

internal fun storedTranscriptionEngine(value: String?): TranscriptionEngine = when (value) {
    null, "GPT_TRANSCRIBE", TranscriptionEngine.BRIDGE_WHISPER.name -> TranscriptionEngine.BRIDGE_WHISPER
    TranscriptionEngine.DEVICE_SPEECH.name -> TranscriptionEngine.DEVICE_SPEECH
    else -> TranscriptionEngine.BRIDGE_WHISPER
}

object RelayUrlPolicy {
    fun normalize(value: String): String {
        val trimmed = value.trim().trimEnd('/')
        require(trimmed.length in 10..300) { "Enter a complete relay URL" }
        val uri = java.net.URI(trimmed)
        val allowedScheme = uri.scheme == "https" || (BuildConfig.DEBUG && uri.scheme == "http")
        require(allowedScheme && !uri.host.isNullOrBlank() && uri.userInfo == null) {
            "Use an HTTPS relay URL"
        }
        require(uri.query == null && uri.fragment == null) { "Relay URL cannot include a query or fragment" }
        return trimmed
    }
}
