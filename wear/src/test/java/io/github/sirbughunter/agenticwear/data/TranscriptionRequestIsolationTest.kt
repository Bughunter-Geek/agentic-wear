package io.github.sirbughunter.agenticwear.data
import org.junit.Assert.*
import org.junit.Test
class TranscriptionRequestIsolationTest {
    @Test fun unrelatedChatOrCatalogResultCannotStopPendingDictation() {
        assertFalse(shouldFinishTranscriptionWait("dictation", "dictation", null))
        assertFalse(shouldFinishTranscriptionWait("dictation", "dictation", "old-result"))
    }
    @Test fun matchingResultOrResolvedMatchingRequestStopsTheWait() {
        assertTrue(shouldFinishTranscriptionWait("dictation", "dictation", "dictation"))
        assertTrue(shouldFinishTranscriptionWait("dictation", null, null))
    }
}
