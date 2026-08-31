package io.github.sirbughunter.agenticwear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    @Test
    fun `only the active transcription request can publish a result`() {
        assertTrue(shouldAcceptTranscriptionResult("request-current", "request-current"))
        assertFalse(shouldAcceptTranscriptionResult("request-current", "request-old"))
        assertFalse(shouldAcceptTranscriptionResult(null, "request-old"))
    }
}
