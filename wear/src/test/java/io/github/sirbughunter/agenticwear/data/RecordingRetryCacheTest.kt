package io.github.sirbughunter.agenticwear.data

import io.github.sirbughunter.agenticwear.model.Transcript
import org.junit.Assert.*
import org.junit.Test

class RecordingRetryCacheTest {
    @Test fun `retry uses identical audio and original edit base with fresh request identity`() {
        val cache = RecordingRetryCache()
        val base = Transcript("base", "Keep 9 invoices. Do not delete the file.", "thread")
        val bytes = byteArrayOf(1, 2, 3)
        cache.retain(bytes, "first", "thread", base, 100)
        bytes.fill(0)
        val replay = cache.replay("first", "retry", 200)!!
        assertArrayEquals(byteArrayOf(1, 2, 3), replay.bytes)
        assertEquals(base, replay.revisionBase)
        assertEquals("thread", replay.threadId)
        assertTrue(cache.available("retry", 200))
        assertTrue(cache.available("first", 200)) // cancelled/failed retry
        replay.bytes.fill(0)
        assertArrayEquals(byteArrayOf(1, 2, 3), cache.replay("retry", "next", 201)!!.bytes)
        assertFalse(cache.available("first", 201)) // bounded identities
        assertFalse(shouldAcceptTranscriptionResult("next", "retry"))
        assertTrue(shouldAcceptTranscriptionResult("next", "next"))
    }
    @Test fun `replacement discard expiry and process recreation cannot replay stale recordings`() {
        val cache = RecordingRetryCache(maxBytes = 4, lifetimeMillis = 100)
        cache.retain(byteArrayOf(1), "one", null, null, 10)
        cache.retain(byteArrayOf(2), "two", "new-thread", null, 20)
        assertNull(cache.replay("one", "wrong", 30))
        assertTrue(cache.available("two", 119))
        assertNull(cache.replay("two", "expired", 120))
        cache.retain(byteArrayOf(3), "three", null, null, 130)
        cache.clear()
        assertFalse(cache.available("three", 131))
        assertFalse(RecordingRetryCache().available("two", 21))
    }
    @Test fun `retry does not extend retention and never accepts empty or oversized audio`() {
        val cache = RecordingRetryCache(maxBytes = 4, lifetimeMillis = 100)
        cache.retain(byteArrayOf(1), "one", null, null, 10)
        assertNotNull(cache.replay("one", "two", 100))
        assertFalse(cache.available("two", 110))
        for (bytes in listOf(byteArrayOf(), ByteArray(5))) {
            try { cache.retain(bytes, "bad", null, null, 120); fail("Invalid audio retained") }
            catch (_: IllegalArgumentException) { }
        }
    }
    @Test fun `a retry on a new backend preserves AAC semantics and edit intent`() {
        val plain = recordingTranscriptionPayload("new", "audio", "thread", null, "phonon")
        assertEquals("new", plain.requestId)
        assertEquals("audio/aac", plain.mimeType)
        assertEquals("audio", plain.audioBase64)
        assertEquals("phonon", plain.backend)
        assertTrue(plain.finalIntent)
        assertFalse(plain.localEdit)
        val originalBase = Transcript("base", "Do not delete 9 files.", "thread")
        val edit = recordingTranscriptionPayload("edit-retry", "same-audio", "thread", originalBase, "phonon")
        assertEquals(originalBase.text, edit.previousText)
        assertTrue(edit.localEdit)
        assertFalse(edit.finalIntent)
        val whisper = recordingTranscriptionPayload("whisper-retry", "same-audio", "thread", null, "whisper")
        assertEquals("whisper", whisper.backend)
        assertFalse(whisper.finalIntent)
    }
}
