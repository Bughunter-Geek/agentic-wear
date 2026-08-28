package io.github.sirbughunter.agenticwear.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class TranscriptionLatencyTest {
    @Test
    fun `elapsed time uses the monotonic clock delta`() {
        assertEquals(4_321L, elapsedRealtimeDelta(startedAtMillis = 12_000L, nowMillis = 16_321L))
        assertEquals(0L, elapsedRealtimeDelta(startedAtMillis = 12_000L, nowMillis = 11_999L))
    }

    @Test
    fun `elapsed time remains compact from tenths through minutes`() {
        assertEquals("0.0 s", formatTranscriptionElapsed(0L))
        assertEquals("5.0 s", formatTranscriptionElapsed(5_049L))
        assertEquals("59.9 s", formatTranscriptionElapsed(59_999L))
        assertEquals("1:05.4", formatTranscriptionElapsed(65_432L))
    }
}
