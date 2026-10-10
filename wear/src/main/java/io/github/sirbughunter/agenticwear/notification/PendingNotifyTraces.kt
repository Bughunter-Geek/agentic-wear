package io.github.sirbughunter.agenticwear.notification

internal const val MAX_PENDING_NOTIFY_TRACES = 10

/**
 * Traces recorded while the Watch had no network (alerts handled from a push-carried envelope) that
 * wait for the next successful relay fetch. Bounded and thread-safe; the oldest trace is dropped first.
 */
internal class PendingNotifyTraces(private val capacity: Int = MAX_PENDING_NOTIFY_TRACES) {
    private val traces = ArrayList<NotifyTrace>(capacity)

    @Synchronized fun add(trace: NotifyTrace) {
        traces += trace
        while (traces.size > capacity) traces.removeAt(0)
    }

    @Synchronized fun snapshot(): List<NotifyTrace> = traces.toList()

    /** Removes exactly the given traces (by identity), leaving ones added since the snapshot. */
    @Synchronized fun remove(sent: Collection<NotifyTrace>) {
        traces.removeAll { candidate -> sent.any { it === candidate } }
    }
}
