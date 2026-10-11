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
import io.github.sirbughunter.agenticwear.model.SubmittedTurn
import io.github.sirbughunter.agenticwear.model.pruneSubmittedTurns
import io.github.sirbughunter.agenticwear.model.SubmissionPhase
import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import org.json.JSONArray
import org.json.JSONObject

class AppPreferences(context: Context) {
    private val prefs = context.getSharedPreferences("agentic_wear_state", Context.MODE_PRIVATE)

    var liveVoiceColour: String
        get() = prefs.getString("live_voice_colour", "Teal") ?: "Teal"
        set(value) = prefs.edit { putString("live_voice_colour", value) }

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

    var popSoundEnabled: Boolean
        get() = prefs.getBoolean(KEY_POP_SOUND, DEFAULT_POP_SOUND_ENABLED)
        set(value) = prefs.edit { putBoolean(KEY_POP_SOUND, value) }

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

    var localInventoryComplete: Boolean?
        get() = if (prefs.contains("local_inventory_complete")) prefs.getBoolean("local_inventory_complete", false) else null
        set(value) = prefs.edit {
            if (value == null) remove("local_inventory_complete") else putBoolean("local_inventory_complete", value)
        }

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

    /** Per-chat "last opened on the watch" times, bounded; drives the Priority unread-reply rule. */
    fun chatLastOpened(): Map<String, Long> = decodeLastOpened(prefs.getString(KEY_CHAT_LAST_OPENED, null))

    fun markChatOpened(threadId: String, nowMillis: Long = System.currentTimeMillis()) = synchronized(lastOpenedLock) {
        prefs.edit { putString(KEY_CHAT_LAST_OPENED, encodeLastOpened(withChatOpened(chatLastOpened(), threadId, nowMillis))) }
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

    // Same private on-device storage as drafts/history; never logged or sent as telemetry.
    val submittedTurns: List<SubmittedTurn>
        get() = synchronized(submissionLock) { runCatching {
            val data = JSONArray(prefs.getString("submitted_turns", "[]"))
            (0 until data.length()).mapNotNull { index ->
                val item = data.getJSONObject(index)
                val id = item.optString("requestId").takeIf(::isSafeModel) ?: return@mapNotNull null
                val text = item.optString("text").takeIf { it.isNotBlank() && it.length <= 12_000 } ?: return@mapNotNull null
                SubmittedTurn(id, item.optString("threadId").takeIf(::isSafeModel), text,
                    item.optLong("createdAt"), runCatching { SubmissionPhase.valueOf(item.getString("phase")) }.getOrDefault(SubmissionPhase.UNCERTAIN),
                    item.optString("nativeTurnId").takeIf(::isSafeModel), item.optString("nativeMessageId").takeIf(::isSafeModel))
            }.takeLast(16).let { pruneSubmittedTurns(it, System.currentTimeMillis()) }
        }.getOrDefault(emptyList()) }

    fun changeSubmittedTurns(change: (List<SubmittedTurn>) -> List<SubmittedTurn>) = synchronized(submissionLock) {
        val previous = submittedTurns
        val updated = pruneSubmittedTurns(change(previous).takeLast(16), System.currentTimeMillis())
        if (updated == previous) return@synchronized
        val data = JSONArray()
        updated.forEach { item ->
            data.put(JSONObject().put("requestId", item.requestId).put("threadId", item.threadId)
                .put("text", item.text).put("createdAt", item.createdAtMillis).put("phase", item.phase.name)
                .put("nativeTurnId", item.nativeTurnId).put("nativeMessageId", item.nativeMessageId))
        }
        check(prefs.edit().putString("submitted_turns", data.toString()).commit()) { "Could not preserve the submitted message safely." }
    }

    /** Local only: removes the echo and abandons its pending delivery so "Check status" cannot return. Sends nothing. */
    fun dismissSubmittedTurn(requestId: String) {
        val pendingId = pendingTurnRequestId
        val result = io.github.sirbughunter.agenticwear.model.dismissStuckSend(submittedTurns, pendingId, requestId)
        if (result.clearPendingDelivery) {
            pendingTurnRequestId = null // also drops the stored envelope and fingerprint
            pending = false
            lastError = null
            lastAcceptedTurnRequestId = null
        }
        changeSubmittedTurns { io.github.sirbughunter.agenticwear.model.dismissSubmittedTurn(it, requestId) }
    }

    fun updateSubmittedTurn(requestId: String, change: (SubmittedTurn) -> SubmittedTurn) =
        changeSubmittedTurns { items -> items.map { if (it.requestId == requestId) change(it) else it } }

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

    // Already encrypted for the paired bridge; no prompt plaintext is stored.
    var pendingTurnEnvelope: String?
        get() = prefs.getString("pending_turn_envelope", null)
        set(value) = prefs.edit(commit = true) { putString("pending_turn_envelope", value) }

    var pendingTurnFingerprint: String?
        get() = prefs.getString("pending_turn_fingerprint", null)
        private set(value) = prefs.edit { putString("pending_turn_fingerprint", value) }

    internal fun savePendingTurnDelivery(delivery: PendingTurnDelivery) {
        check(prefs.edit()
            .putString(KEY_PENDING_TURN_REQUEST, delivery.requestId)
            .putString("pending_turn_envelope", delivery.envelope)
            .putString("pending_turn_fingerprint", delivery.fingerprint)
            .commit()) { "Could not save the prompt safely. Nothing was sent." }
    }

    var pendingTurnRequestId: String?
        get() = prefs.getString(KEY_PENDING_TURN_REQUEST, null)
        set(value) = prefs.edit(commit = true) {
            putString(KEY_PENDING_TURN_REQUEST, value)
            if (value == null) {
                remove("pending_turn_envelope")
                remove("pending_turn_fingerprint")
            }
        }

    var pendingTranscriptionRequestId: String?
        get() = prefs.getString(KEY_PENDING_TRANSCRIPTION_REQUEST, null)
        set(value) = prefs.edit { putString(KEY_PENDING_TRANSCRIPTION_REQUEST, value) }

    fun markTranscriptionCancelled(requestId: String) {
        if (!isSafeModel(requestId)) return
        synchronized(cancelledTranscriptionLock) {
            val updated = appendBoundedRequestId(cancelledTranscriptionRequestIds(), requestId)
            prefs.edit(commit = true) {
                putString(KEY_CANCELLED_TRANSCRIPTION_REQUESTS, JSONArray(updated).toString())
            }
        }
    }

    fun isTranscriptionCancelled(requestId: String): Boolean = synchronized(cancelledTranscriptionLock) {
        requestId in cancelledTranscriptionRequestIds()
    }

    fun consumeCancelledTranscription(requestId: String): Boolean = synchronized(cancelledTranscriptionLock) {
        val current = cancelledTranscriptionRequestIds()
        if (requestId !in current) return@synchronized false
        prefs.edit(commit = true) {
            putString(
                KEY_CANCELLED_TRANSCRIPTION_REQUESTS,
                JSONArray(current.filterNot { it == requestId }).toString(),
            )
        }
        true
    }

    var lastReadyChatRequestId: String?
        get() = prefs.getString("last_ready_chat_request", null)
        set(value) = prefs.edit { putString("last_ready_chat_request", value) }

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

    fun alertHistory(): List<AgentAlert> = PayloadCodec.alertsFromJson(
        prefs.getString(KEY_ALERTS, "[]").orEmpty(),
    )

    private fun cancelledTranscriptionRequestIds(): List<String> = runCatching {
        val values = JSONArray(prefs.getString(KEY_CANCELLED_TRANSCRIPTION_REQUESTS, "[]").orEmpty())
        buildList {
            for (index in 0 until values.length()) {
                values.optString(index).takeIf(::isSafeModel)?.let(::add)
            }
        }
    }.getOrDefault(emptyList())

    private fun encodeTranscript(transcript: Transcript): String = JSONObject()
        .put("requestId", transcript.requestId)
        .put("text", transcript.text)
        .put("threadId", transcript.threadId)
        .put("revised", transcript.revised)
        .put("undoText", transcript.undoText)
        .put("editNotice", transcript.editNotice)
        .put("editChoices", JSONArray(transcript.editChoices))
        .apply { transcript.rawText?.let { put("rawText", it) } }
        .toString()

    private fun decodeTranscript(encoded: String): Transcript? = runCatching {
        val json = JSONObject(encoded)
        Transcript(
            requestId = json.getString("requestId"),
            text = json.getString("text"),
            threadId = json.optString("threadId").ifEmpty { null },
            revised = json.optBoolean("revised", false),
            undoText = json.optString("undoText").takeIf { json.has("undoText") && !json.isNull("undoText") && it.isNotBlank() },
            editNotice = json.optString("editNotice").takeIf { json.has("editNotice") && !json.isNull("editNotice") && it.isNotBlank() },
            editChoices = (json.optJSONArray("editChoices") ?: JSONArray()).let { choices -> (0 until minOf(choices.length(), 5)).map { choices.optString(it) } },
            rawText = if (json.has("rawText")) json.optString("rawText").takeIf { it.isNotBlank() } else null,
        )
    }.getOrNull()

    companion object {
        private val submissionLock = Any()
        private const val KEY_RELAY_URL = "relay_url"
        private const val KEY_SELECTED_THREAD = "selected_thread"
        private const val KEY_SUBMIT_DRAFT_AS_NEW_SESSION = "submit_draft_as_new_session"
        private const val KEY_ENGINE = "transcription_engine"
        private const val KEY_APPROVAL_MODE = "approval_mode"
        private const val KEY_COLLAPSE_UPDATES = "collapse_updates"
        internal const val DEFAULT_POP_SOUND_ENABLED = true
        private const val KEY_POP_SOUND = "pop_sound_enabled"
        private const val KEY_MODEL = "model"
        private const val KEY_REASONING_EFFORT = "reasoning_effort"
        private const val KEY_SESSIONS = "sessions"
        private const val KEY_MODELS = "models"
        private const val KEY_ALERT = "latest_alert"
        private const val KEY_ALERTS = "recent_alerts"
        private const val KEY_CHAT_LAST_OPENED = "chat_last_opened"
        private val lastOpenedLock = Any()
        private const val KEY_TRANSCRIPT = "transcript"
        private const val KEY_REVISION_BASE = "revision_base"
        private const val KEY_CHAT_SNAPSHOT = "chat_snapshot"
        private const val KEY_CHAT_FEEDBACK = "chat_feedback"
        private const val KEY_PENDING_TURN_REQUEST = "pending_turn_request"
        private const val KEY_PENDING_TRANSCRIPTION_REQUEST = "pending_transcription_request"
        private const val KEY_CANCELLED_TRANSCRIPTION_REQUESTS = "cancelled_transcription_requests"
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
private val cancelledTranscriptionLock = Any()

internal fun appendBoundedRequestId(
    existing: List<String>,
    requestId: String,
    limit: Int = 16,
): List<String> = (existing.filterNot { it == requestId } + requestId).takeLast(limit)

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
    TranscriptionEngine.BRIDGE_PHONON.name -> TranscriptionEngine.BRIDGE_PHONON
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

internal const val MAX_CHAT_LAST_OPENED = 200

/** Records [threadId] as opened now, evicting the oldest-opened entries beyond [max]. */
internal fun withChatOpened(
    current: Map<String, Long>,
    threadId: String,
    nowMillis: Long,
    max: Int = MAX_CHAT_LAST_OPENED,
): Map<String, Long> {
    if (threadId.isBlank()) return current
    val merged = current.toMutableMap().apply { put(threadId, nowMillis) }
    if (merged.size <= max) return merged
    return merged.entries.sortedByDescending { it.value }.take(max).associate { it.key to it.value }
}

private fun encodeLastOpened(map: Map<String, Long>): String =
    JSONObject().also { json -> map.forEach { (id, at) -> json.put(id, at) } }.toString()

private fun decodeLastOpened(raw: String?): Map<String, Long> = runCatching {
    val json = JSONObject(raw ?: return emptyMap())
    buildMap { json.keys().forEach { id -> put(id, json.optLong(id, 0L)) } }
}.getOrDefault(emptyMap())
