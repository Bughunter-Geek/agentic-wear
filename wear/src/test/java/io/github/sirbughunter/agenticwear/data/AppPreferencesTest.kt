package io.github.sirbughunter.agenticwear.data

import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.Callable
import java.util.concurrent.Executors

class AppPreferencesTest {
    @Test
    fun `new installs default to private bridge whisper`() {
        assertEquals(TranscriptionEngine.BRIDGE_WHISPER, storedTranscriptionEngine(null))
    }

    @Test
    fun `legacy GPT preference migrates to private bridge whisper`() {
        assertEquals(TranscriptionEngine.BRIDGE_WHISPER, storedTranscriptionEngine("GPT_TRANSCRIBE"))
    }

    @Test
    fun `explicit device speech preference is preserved`() {
        assertEquals(TranscriptionEngine.DEVICE_SPEECH, storedTranscriptionEngine("DEVICE_SPEECH"))
    }

    @Test
    fun `a concurrently delivered event is claimed exactly once`() {
        var storedIds: String? = null
        val executor = Executors.newFixedThreadPool(12)
        try {
            val claims = executor.invokeAll(
                List(24) {
                    Callable {
                        claimHandledEvent(
                            eventId = "same-event",
                            read = { storedIds },
                            write = { storedIds = it },
                        )
                    }
                },
            ).map { it.get() }

            assertEquals(1, claims.count { it })
            assertTrue(claims.any { it })
            assertFalse(claims.dropWhile { !it }.drop(1).any { it })
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `cancelled transcription ids are deduplicated and bounded`() {
        val existing = (1..16).map { "request-$it" }

        assertEquals(
            (2..16).map { "request-$it" } + "request-17",
            appendBoundedRequestId(existing, "request-17"),
        )
        assertEquals(
            (1..15).map { "request-$it" } + "request-16",
            appendBoundedRequestId(existing, "request-16"),
        )
    }
}
