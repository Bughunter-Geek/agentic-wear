package io.github.sirbughunter.agenticwear.ui

import io.github.sirbughunter.agenticwear.model.Transcript
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplyFlowPolicyTest {
    @Test
    fun `text reply opens an empty draft on the exact live chat`() {
        val draft = Transcript("reply-request", "", "thread-live")
        val state = prepareTextReply(
            WearUiState(screen = WearScreen.REPLY, pending = true, error = "old error"),
            draft,
        )

        assertEquals(WearScreen.TRANSCRIPT, state.screen)
        assertEquals("thread-live", state.selectedThreadId)
        assertEquals(draft, state.transcript)
        assertTrue(state.replyingFromChat)
        assertFalse(state.pending)
        assertNull(state.error)
        assertEquals("thread-live", threadIdForDraftSubmission(state))
    }
}
