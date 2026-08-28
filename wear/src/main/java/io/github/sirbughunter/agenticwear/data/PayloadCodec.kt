package io.github.sirbughunter.agenticwear.data

import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AgentSession
import io.github.sirbughunter.agenticwear.model.AlertKind
import io.github.sirbughunter.agenticwear.model.BridgePayload
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
            .toString()
        is BridgePayload.SubmitTurn -> JSONObject()
            .put("version", 1)
            .put("kind", "turn.submit")
            .put("requestId", payload.requestId)
            .put("threadId", payload.threadId)
            .put("text", payload.text)
            .toString()
        is BridgePayload.ApprovalResponse -> JSONObject()
            .put("version", 1)
            .put("kind", "approval.respond")
            .put("requestId", payload.requestId)
            .put("approvalId", payload.approvalId)
            .put("decision", payload.decision)
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
        val detail = clean(json.optString("detail"), 260).ifEmpty {
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

    fun decodeTranscript(json: JSONObject): Transcript? {
        if (json.optInt("version") != 1 || json.optString("kind") != "transcription.ready") return null
        val requestId = json.optString("requestId").takeIf(::isSafeId) ?: return null
        val text = clean(json.optString("text"), 4_000)
        if (text.isEmpty()) return null
        return Transcript(requestId, text, json.optString("threadId").takeIf(::isSafeId))
    }

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
            detail = clean(item.getString("detail"), 260),
            occurredAtMillis = item.getLong("occurredAt"),
            approvalId = item.optString("approvalId").takeIf(::isSafeId),
            canControl = item.optBoolean("canControl"),
        )
    }.getOrNull()

    private fun clean(value: String, limit: Int): String = value.trim().replace(Regex("\\s+"), " ").take(limit)

    private fun isSafeId(value: String): Boolean = value.length in 1..128 &&
        value.all { it.isLetterOrDigit() || it in "-_.:" }
}

internal fun acceptsAlertEnvelope(kind: String, turnScope: String): Boolean = when (kind) {
    "terminal.completed", "terminal.failed", "terminal.interrupted", "terminal.blocked" ->
        turnScope == "topLevel"
    "approval.request" -> true
    else -> false
}
