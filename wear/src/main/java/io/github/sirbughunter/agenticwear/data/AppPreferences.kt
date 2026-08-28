package io.github.sirbughunter.agenticwear.data

import android.content.Context
import androidx.core.content.edit
import io.github.sirbughunter.agenticwear.BuildConfig
import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AgentSession
import io.github.sirbughunter.agenticwear.model.ApprovalMode
import io.github.sirbughunter.agenticwear.model.Transcript
import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import org.json.JSONObject

class AppPreferences(context: Context) {
    private val prefs = context.getSharedPreferences("agentic_wear_state", Context.MODE_PRIVATE)

    var relayUrl: String
        get() = prefs.getString(KEY_RELAY_URL, null).orEmpty().ifEmpty { BuildConfig.DEFAULT_RELAY_URL }
        set(value) = prefs.edit { putString(KEY_RELAY_URL, RelayUrlPolicy.normalize(value)) }

    var selectedThreadId: String?
        get() = prefs.getString(KEY_SELECTED_THREAD, null)
        set(value) = prefs.edit { putString(KEY_SELECTED_THREAD, value) }

    var transcriptionEngine: TranscriptionEngine
        get() = storedTranscriptionEngine(prefs.getString(KEY_ENGINE, null))
        set(value) = prefs.edit { putString(KEY_ENGINE, value.name) }

    var approvalMode: ApprovalMode
        get() = enumValue(prefs.getString(KEY_APPROVAL_MODE, null), ApprovalMode.ALERT_ONLY)
        set(value) = prefs.edit { putString(KEY_APPROVAL_MODE, value.name) }

    var sessions: List<AgentSession>
        get() = PayloadCodec.sessionsFromJson(prefs.getString(KEY_SESSIONS, "[]").orEmpty())
        set(value) = prefs.edit { putString(KEY_SESSIONS, PayloadCodec.sessionsToJson(value)) }

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
        get() = prefs.getString(KEY_TRANSCRIPT, null)?.let { encoded ->
            runCatching {
                val json = JSONObject(encoded)
                Transcript(
                    requestId = json.getString("requestId"),
                    text = json.getString("text"),
                    threadId = json.optString("threadId").ifEmpty { null },
                )
            }.getOrNull()
        }
        set(value) = prefs.edit {
            putString(
                KEY_TRANSCRIPT,
                value?.let {
                    JSONObject()
                        .put("requestId", it.requestId)
                        .put("text", it.text)
                        .put("threadId", it.threadId)
                        .toString()
                },
            )
        }

    var pending: Boolean
        get() = prefs.getBoolean(KEY_PENDING, false)
        set(value) = prefs.edit { putBoolean(KEY_PENDING, value) }

    var lastError: String?
        get() = prefs.getString(KEY_LAST_ERROR, null)
        set(value) = prefs.edit { putString(KEY_LAST_ERROR, value?.take(180)) }

    fun markEventHandled(eventId: String): Boolean {
        val ids = prefs.getString(KEY_HANDLED_IDS, null)
            .orEmpty()
            .split(',')
            .filter(String::isNotBlank)
            .toMutableList()
        if (eventId in ids) return false
        ids += eventId
        prefs.edit(commit = true) { putString(KEY_HANDLED_IDS, ids.takeLast(100).joinToString(",")) }
        return true
    }

    private inline fun <reified T : Enum<T>> enumValue(value: String?, fallback: T): T =
        value?.let { runCatching { enumValueOf<T>(it) }.getOrNull() } ?: fallback

    private fun alertHistory(): List<AgentAlert> = PayloadCodec.alertsFromJson(
        prefs.getString(KEY_ALERTS, "[]").orEmpty(),
    )

    companion object {
        private const val KEY_RELAY_URL = "relay_url"
        private const val KEY_SELECTED_THREAD = "selected_thread"
        private const val KEY_ENGINE = "transcription_engine"
        private const val KEY_APPROVAL_MODE = "approval_mode"
        private const val KEY_SESSIONS = "sessions"
        private const val KEY_ALERT = "latest_alert"
        private const val KEY_ALERTS = "recent_alerts"
        private const val KEY_TRANSCRIPT = "transcript"
        private const val KEY_PENDING = "pending"
        private const val KEY_LAST_ERROR = "last_error"
        private const val KEY_HANDLED_IDS = "handled_ids"
    }
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
