package io.github.sirbughunter.agenticwear.notification

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class PendingNotifyTracesTest {
    private fun trace(n: Long) = NotifyTrace(n, n, n, emptyList(), deliveredVia = DELIVERED_VIA_PUSH)

    @Test fun `queue is bounded and drops the oldest`() {
        val queue = PendingNotifyTraces()
        val all = (1L..(MAX_PENDING_NOTIFY_TRACES + 3L)).map { trace(it).also(queue::add) }
        val kept = queue.snapshot()
        assertEquals(MAX_PENDING_NOTIFY_TRACES, kept.size)
        assertSame(all[3], kept.first())
        assertSame(all.last(), kept.last())
    }

    @Test fun `remove forgets only the sent traces`() {
        val queue = PendingNotifyTraces()
        val a = trace(1); val b = trace(2); val c = trace(3)
        queue.add(a); queue.add(b)
        val snapshot = queue.snapshot()
        queue.add(c)
        queue.remove(snapshot)
        assertEquals(listOf(c), queue.snapshot())
    }

    @Test fun `removing nothing keeps everything`() {
        val queue = PendingNotifyTraces()
        queue.add(trace(1))
        queue.remove(emptyList())
        assertEquals(1, queue.snapshot().size)
    }
}
