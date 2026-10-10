package io.github.sirbughunter.agenticwear.notification

/**
 * What a push-triggered inbox refresh did with one terminal alert. The wire names are part of the
 * bridge's `notify.trace` schema, so they must not change without changing the bridge.
 */
internal enum class AlertDecision(val wire: String) {
    POSTED("posted"),
    DUPLICATE("duplicate"),
    SUPPRESSED_NOTIFY_OFF("suppressed_notify_off"),
    SUPPRESSED_BEFORE_FOREGROUND("suppressed_before_foreground"),
}

/**
 * Names the outcome from the same inputs that gate [AgentNotifier.post]: the alert is posted only for a
 * first delivery that [shouldPostAlertNotification] allows. This mirrors that rule; it never replaces it.
 */
internal fun alertDecision(
    firstDelivery: Boolean,
    notify: Boolean,
    occurredAtMillis: Long,
    notifyAfterMillis: Long?,
): AlertDecision = when {
    !firstDelivery -> AlertDecision.DUPLICATE
    shouldPostAlertNotification(notify, occurredAtMillis, notifyAfterMillis) -> AlertDecision.POSTED
    !notify -> AlertDecision.SUPPRESSED_NOTIFY_OFF
    else -> AlertDecision.SUPPRESSED_BEFORE_FOREGROUND
}

internal const val MAX_NOTIFY_TRACE_ALERTS = 10

/** Metadata only: ids, decisions and Watch wall-clock epoch milliseconds. No titles, details or text. */
internal data class TerminalAlertTrace(
    val eventId: String,
    val decision: AlertDecision,
    val decidedAtMillis: Long,
)

internal data class NotifyTrace(
    val pushReceivedAtMillis: Long,
    val fetchStartedAtMillis: Long,
    val fetchCompletedAtMillis: Long,
    val alerts: List<TerminalAlertTrace>,
    /** 1-based attempt of the push-triggered inbox fetch that produced this trace. */
    val fetchAttempt: Int = 1,
    /** "push" when the envelope was carried in the push and handled without a fetch, else "fetch". */
    val deliveredVia: String = DELIVERED_VIA_FETCH,
)

internal const val DELIVERED_VIA_FETCH = "fetch"
internal const val DELIVERED_VIA_PUSH = "push"

/**
 * Collects the timing of one push-triggered inbox refresh. Used from a single coroutine while the
 * inbox refresh lock is held, so it is intentionally not thread-safe.
 */
internal class NotifyTraceRecorder(
    private val pushReceivedAtMillis: Long,
    private val fetchAttempt: Int = 1,
    private val deliveredVia: String = DELIVERED_VIA_FETCH,
) {
    private var fetchStartedAtMillis = 0L
    private var fetchCompletedAtMillis = 0L
    private val alerts = ArrayList<TerminalAlertTrace>(MAX_NOTIFY_TRACE_ALERTS)

    fun fetchStarted(nowMillis: Long) {
        fetchStartedAtMillis = nowMillis
    }

    fun fetchCompleted(nowMillis: Long) {
        fetchCompletedAtMillis = nowMillis
    }

    fun alertDecided(eventId: String, decision: AlertDecision, decidedAtMillis: Long) {
        if (alerts.size < MAX_NOTIFY_TRACE_ALERTS) alerts += TerminalAlertTrace(eventId, decision, decidedAtMillis)
    }

    /** Null unless at least one terminal alert was processed; there is nothing worth reporting otherwise. */
    fun result(): NotifyTrace? = alerts.takeIf { it.isNotEmpty() }?.let {
        NotifyTrace(pushReceivedAtMillis, fetchStartedAtMillis, fetchCompletedAtMillis, it.toList(), fetchAttempt, deliveredVia)
    }
}
