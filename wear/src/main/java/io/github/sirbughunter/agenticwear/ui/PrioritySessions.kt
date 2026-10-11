package io.github.sirbughunter.agenticwear.ui

import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AgentSession
import io.github.sirbughunter.agenticwear.model.AlertKind
import io.github.sirbughunter.agenticwear.model.SessionStatus

/** Why a chat is in the Priority list, in display order. */
enum class PriorityReason(val label: String) {
    NEEDS_YOU("Needs you"),
    WORKING("Working"),
    NEW_REPLY("New reply"),
    ERROR("Error"),
}

data class PriorityEntry(val session: AgentSession, val reason: PriorityReason)

/** A finished reply is unread when its COMPLETE alert is newer than the last time the chat was opened here. */
fun hasUnreadReply(threadId: String, alerts: List<AgentAlert>, lastOpened: Map<String, Long>): Boolean {
    val opened = lastOpened[threadId] ?: 0L
    return alerts.any { it.kind == AlertKind.COMPLETE && it.threadId == threadId && it.occurredAtMillis > opened }
}

/**
 * Attention first, then running, then unread replies, then errors; newest first within each
 * group. Each session appears once, under its highest-priority reason.
 */
fun prioritySessions(
    sessions: List<AgentSession>,
    alerts: List<AgentAlert>,
    lastOpened: Map<String, Long>,
): List<PriorityEntry> = sessions.distinctBy { it.id }.mapNotNull { session ->
    val reason = when {
        session.attention != null -> PriorityReason.NEEDS_YOU
        session.status == SessionStatus.ACTIVE -> PriorityReason.WORKING
        hasUnreadReply(session.id, alerts, lastOpened) -> PriorityReason.NEW_REPLY
        session.status == SessionStatus.ERROR -> PriorityReason.ERROR
        else -> null
    }
    reason?.let { PriorityEntry(session, it) }
}.sortedWith(compareBy<PriorityEntry> { it.reason.ordinal }.thenByDescending { it.session.updatedAtMillis })

/** Secondary row label for browser-route chats; null for Mac chats. */
fun sourceLabel(source: String?): String? = when (source) {
    "cloud" -> "Cloud"
    "dot" -> "Dot"
    else -> null
}

/** Check-status is only offered in the chat the unconfirmed request belongs to. */
fun canCheckDeliveryHere(canCheck: Boolean, pendingThreadId: String?, chatThreadId: String?): Boolean =
    canCheck && pendingThreadId == chatThreadId
