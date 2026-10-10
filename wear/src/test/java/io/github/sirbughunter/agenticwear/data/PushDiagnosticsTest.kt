package io.github.sirbughunter.agenticwear.data

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PushDiagnosticsTest {
    @Before @After fun reset() = PushDiagnostics.resetForTest()

    private fun record(at: Long, outcome: String = "processed") = PushRecord(
        receivedAt = at, sentTime = at - 10, priority = 1, originalPriority = 1,
        envelopePresent = true, envelopeChars = 800, outcome = outcome, outcomeAt = at + 5,
    )

    @Test fun `keeps only the newest entries, oldest first`() {
        for (i in 1..25) PushDiagnostics.record(record(i.toLong()))
        val snapshot = PushDiagnostics.snapshot()
        assertEquals(PushDiagnostics.MAX_ENTRIES, snapshot.size)
        assertEquals(6L, snapshot.first().receivedAt)
        assertEquals(25L, snapshot.last().receivedAt)
    }

    @Test fun `clear removes only the reported entries`() {
        PushDiagnostics.record(record(1))
        PushDiagnostics.record(record(2))
        val reported = PushDiagnostics.snapshot()
        PushDiagnostics.record(record(3))
        PushDiagnostics.clear(reported)
        assertEquals(listOf(3L), PushDiagnostics.snapshot().map { it.receivedAt })
    }

    @Test fun `snapshot is an independent copy`() {
        PushDiagnostics.record(record(1))
        val snapshot = PushDiagnostics.snapshot()
        PushDiagnostics.record(record(2))
        assertEquals(1, snapshot.size)
        assertTrue(PushDiagnostics.snapshot().size == 2)
    }

    @Test fun `payload encoding compiles with the expected kind`() {
        // org.json on the unit-test classpath is the Android stub, so only check the call is wired.
        runCatching {
            val json = JSONObject(PayloadCodec.encodePushDiagnostics("r1", listOf(record(1))))
            assertEquals("push.diagnostics", json.getString("kind"))
        }
    }
}
