package io.github.sirbughunter.agenticwear.notification

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class NotifyTraceTest {
    @Test
    fun `a first delivery that the policy allows is posted`() {
        assertEquals(AlertDecision.POSTED, alertDecision(true, true, 20_000L, null))
        assertEquals(AlertDecision.POSTED, alertDecision(true, true, 10_000L, 10_000L))
        assertEquals(AlertDecision.POSTED, alertDecision(true, true, 10_001L, 10_000L))
    }

    @Test
    fun `an already handled event is a duplicate whatever else is true`() {
        assertEquals(AlertDecision.DUPLICATE, alertDecision(false, true, 20_000L, null))
        assertEquals(AlertDecision.DUPLICATE, alertDecision(false, false, 20_000L, null))
        assertEquals(AlertDecision.DUPLICATE, alertDecision(false, true, 1L, 10_000L))
    }

    @Test
    fun `refreshes that must not notify are named notify off`() {
        assertEquals(AlertDecision.SUPPRESSED_NOTIFY_OFF, alertDecision(true, false, 20_000L, null))
        assertEquals(AlertDecision.SUPPRESSED_NOTIFY_OFF, alertDecision(true, false, 1L, 10_000L))
    }

    @Test
    fun `work finished before the app became visible is suppressed by the foreground cutoff`() {
        assertEquals(AlertDecision.SUPPRESSED_BEFORE_FOREGROUND, alertDecision(true, true, 9_999L, 10_000L))
    }

    @Test
    fun `the decision agrees with the notification policy for every combination`() {
        for (firstDelivery in listOf(true, false)) {
            for (notify in listOf(true, false)) {
                for (occurredAt in listOf(1L, 9_999L, 10_000L, 10_001L)) {
                    for (notifyAfter in listOf(null, 10_000L)) {
                        val posts = firstDelivery && shouldPostAlertNotification(notify, occurredAt, notifyAfter)
                        assertEquals(
                            "firstDelivery=$firstDelivery notify=$notify occurredAt=$occurredAt notifyAfter=$notifyAfter",
                            posts,
                            alertDecision(firstDelivery, notify, occurredAt, notifyAfter) == AlertDecision.POSTED,
                        )
                    }
                }
            }
        }
    }

    @Test
    fun `wire names match the bridge notify trace schema`() {
        assertEquals(
            listOf("posted", "duplicate", "suppressed_notify_off", "suppressed_before_foreground"),
            AlertDecision.values().map { it.wire },
        )
    }

    @Test
    fun `a push refresh with no terminal alert reports nothing`() {
        val recorder = NotifyTraceRecorder(pushReceivedAtMillis = 1_000L)
        recorder.fetchStarted(1_050L)
        recorder.fetchCompleted(1_400L)
        assertNull(recorder.result())
    }

    @Test
    fun `the recorder keeps push, fetch and per alert timings`() {
        val recorder = NotifyTraceRecorder(pushReceivedAtMillis = 1_000L)
        recorder.fetchStarted(1_050L)
        recorder.fetchCompleted(1_400L)
        recorder.alertDecided("turn:a:b:completed", AlertDecision.POSTED, 1_450L)
        recorder.alertDecided("turn:a:c:failed", AlertDecision.DUPLICATE, 1_460L)

        val trace = recorder.result()
        assertNotNull(trace)
        assertEquals(1_000L, trace!!.pushReceivedAtMillis)
        assertEquals(1_050L, trace.fetchStartedAtMillis)
        assertEquals(1_400L, trace.fetchCompletedAtMillis)
        assertEquals(
            listOf(
                TerminalAlertTrace("turn:a:b:completed", AlertDecision.POSTED, 1_450L),
                TerminalAlertTrace("turn:a:c:failed", AlertDecision.DUPLICATE, 1_460L),
            ),
            trace.alerts,
        )
    }

    @Test
    fun `the recorder caps alerts and returns an independent snapshot`() {
        val recorder = NotifyTraceRecorder(pushReceivedAtMillis = 1L)
        repeat(MAX_NOTIFY_TRACE_ALERTS + 5) { index ->
            recorder.alertDecided("turn:t:$index:completed", AlertDecision.POSTED, index.toLong())
        }
        val first = recorder.result()!!
        assertEquals(MAX_NOTIFY_TRACE_ALERTS, first.alerts.size)
        assertEquals("turn:t:0:completed", first.alerts.first().eventId)
        recorder.alertDecided("late", AlertDecision.POSTED, 99L)
        assertEquals(MAX_NOTIFY_TRACE_ALERTS, first.alerts.size)
        assertEquals(MAX_NOTIFY_TRACE_ALERTS, recorder.result()!!.alerts.size)
    }

    @Test
    fun `a trace is for the first fetch attempt unless told otherwise`() {
        val recorder = NotifyTraceRecorder(pushReceivedAtMillis = 1_000L)
        recorder.alertDecided("turn:a:b:completed", AlertDecision.POSTED, 1_450L)

        assertEquals(1, recorder.result()!!.fetchAttempt)
        assertEquals(1, NotifyTrace(1L, 2L, 3L, emptyList()).fetchAttempt)
    }

    @Test
    fun `the trace carries the fetch attempt it was recorded on`() {
        for (attempt in 1..4) {
            val recorder = NotifyTraceRecorder(pushReceivedAtMillis = 1_000L, fetchAttempt = attempt)
            recorder.fetchStarted(5_050L)
            recorder.fetchCompleted(5_400L)
            recorder.alertDecided("turn:a:b:completed", AlertDecision.POSTED, 5_450L)

            val trace = recorder.result()!!
            assertEquals(attempt, trace.fetchAttempt)
            // The attempt label never changes the push, fetch or alert timings.
            assertEquals(1_000L, trace.pushReceivedAtMillis)
            assertEquals(5_050L, trace.fetchStartedAtMillis)
            assertEquals(5_400L, trace.fetchCompletedAtMillis)
            assertEquals(listOf(TerminalAlertTrace("turn:a:b:completed", AlertDecision.POSTED, 5_450L)), trace.alerts)
        }
    }

    @Test
    fun `delivered via defaults to fetch and can be push`() {
        assertEquals("fetch", NotifyTrace(1L, 2L, 3L, emptyList()).deliveredVia)
        val fetch = NotifyTraceRecorder(pushReceivedAtMillis = 1L)
        fetch.alertDecided("turn:a:b:completed", AlertDecision.POSTED, 2L)
        assertEquals("fetch", fetch.result()!!.deliveredVia)
        val push = NotifyTraceRecorder(pushReceivedAtMillis = 1L, deliveredVia = DELIVERED_VIA_PUSH)
        push.alertDecided("turn:a:b:completed", AlertDecision.POSTED, 2L)
        assertEquals("push", push.result()!!.deliveredVia)
    }
}
