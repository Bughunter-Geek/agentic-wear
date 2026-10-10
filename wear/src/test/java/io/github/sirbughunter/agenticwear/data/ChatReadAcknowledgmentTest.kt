package io.github.sirbughunter.agenticwear.data

import org.junit.Assert.*
import org.junit.Test

class ChatReadAcknowledgmentTest {
    @Test fun matchingReadSurvivesNewerUncorrelatedStream() {
        assertTrue(isAcknowledgedChatRead("read-new", null, "read-new"))
        assertTrue(isAcknowledgedChatRead("read-new", "read-new", null))
    }
    @Test fun staleReadAndUncorrelatedStreamCannotAcknowledgeNewRequest() {
        assertFalse(isAcknowledgedChatRead("read-new", null, "read-old"))
        assertFalse(isAcknowledgedChatRead("read-new", "read-old", null))
    }
}
