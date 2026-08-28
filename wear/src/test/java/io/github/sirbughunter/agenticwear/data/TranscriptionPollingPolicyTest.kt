package io.github.sirbughunter.agenticwear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TranscriptionPollingPolicyTest {
    @Test
    fun `foreground transcription retrieval stays fast for ten seconds`() {
        val delays = transcriptionReplyDelaysMs()

        assertEquals(150L, delays.first())
        assertTrue(delays.sum() >= 10_000L)
        assertTrue(delays.maxOrNull()!! <= 2_000L)
    }
}
