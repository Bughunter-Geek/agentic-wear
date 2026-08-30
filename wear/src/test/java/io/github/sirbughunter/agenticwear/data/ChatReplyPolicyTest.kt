package io.github.sirbughunter.agenticwear.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatReplyPolicyTest {
    @Test
    fun staleErrorsCannotReplaceTheLatestChatRequest() {
        assertFalse(shouldAcceptChatError("thread-a", "request-new", "thread-a", "request-old"))
        assertFalse(shouldAcceptChatError("thread-a", "request-new", "thread-b", "request-new"))
        assertTrue(shouldAcceptChatError("thread-a", "request-new", "thread-a", "request-new"))
    }

    @Test
    fun snapshotsMustBelongToTheSelectedThreadAndCurrentRequest() {
        assertFalse(shouldAcceptChatSnapshot("thread-a", "request-new", 200, "thread-b", "request-new", 300))
        assertFalse(shouldAcceptChatSnapshot("thread-a", "request-new", 200, "thread-a", "request-old", 300))
        assertFalse(shouldAcceptChatSnapshot("thread-a", null, 300, "thread-a", null, 200))
        assertTrue(shouldAcceptChatSnapshot("thread-a", "request-new", 200, "thread-a", "request-new", 300))
        assertTrue(shouldAcceptChatSnapshot("thread-a", "request-new", 200, "thread-a", null, 300))
    }
}
