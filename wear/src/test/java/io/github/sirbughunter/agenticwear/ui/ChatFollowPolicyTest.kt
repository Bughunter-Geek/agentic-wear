package io.github.sirbughunter.agenticwear.ui

import io.github.sirbughunter.agenticwear.model.ChatMessage
import io.github.sirbughunter.agenticwear.model.ChatPhase
import io.github.sirbughunter.agenticwear.model.ChatRole
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatFollowPolicyTest {
    private val initialMessage = ChatMessage(
        id = "assistant-1",
        turnId = "turn-1",
        role = ChatRole.ASSISTANT,
        text = "Working",
        phase = ChatPhase.COMMENTARY,
    )

    @Test
    fun `same-count streaming text revisions keep following the bottom`() {
        val previous = revision(messages = listOf(initialMessage), thinking = true)
        val current = revision(messages = listOf(initialMessage.copy(text = "Working on the fix")), thinking = true)

        assertTrue(shouldFollowChatRevision(false, true, previous, current))
    }

    @Test
    fun `active to idle revision keeps the final response at the bottom`() {
        val previous = revision(messages = listOf(initialMessage), thinking = true)
        val current = revision(
            messages = listOf(initialMessage.copy(text = "Done", phase = ChatPhase.FINAL_ANSWER)),
            thinking = false,
        )

        assertTrue(shouldFollowChatRevision(false, true, previous, current))
    }

    @Test
    fun `streaming revisions do not pull a reader back after scrolling away`() {
        val previous = revision(messages = listOf(initialMessage), thinking = true)
        val current = revision(messages = listOf(initialMessage.copy(text = "More detail")), thinking = true)

        assertFalse(shouldFollowChatRevision(false, false, previous, current))
    }

    private fun revision(messages: List<ChatMessage>, thinking: Boolean) = ChatFollowRevision(
        messages = messages,
        agentThinking = thinking,
        error = null,
        sendNotice = null,
    )
}

class ChatFollowIntentTest {
    private fun rev(vararg ids: String, status: String? = null) = ChatFollowRevision(
        ids.map { ChatMessage(it, "t", ChatRole.ASSISTANT, it, ChatPhase.FINAL_ANSWER) }, true, null, null, status)

    @Test
    fun `several rows appended at once still follow while following`() {
        val follow = nextFollowLatest(true, userScrollEnded = false, atBottom = false, tappedNewest = false)
        assertTrue(shouldFollowChatRevision(false, follow, rev("a"), rev("a", "b", "c", status = "Working")))
    }

    @Test
    fun `user scroll up stops following and returning to bottom resumes`() {
        var follow = nextFollowLatest(true, userScrollEnded = true, atBottom = false, tappedNewest = false)
        assertFalse(follow)
        assertFalse(shouldFollowChatRevision(false, follow, rev("a"), rev("a", "b")))
        follow = nextFollowLatest(follow, userScrollEnded = true, atBottom = true, tappedNewest = false)
        assertTrue(shouldFollowChatRevision(false, follow, rev("a"), rev("a", "b")))
    }

    @Test
    fun `tapping jump to newest follows again`() {
        val follow = nextFollowLatest(false, userScrollEnded = false, atBottom = false, tappedNewest = true)
        assertTrue(shouldFollowChatRevision(false, follow, rev("a"), rev("a", "b")))
    }

    @Test
    fun `no user scroll keeps the current intent`() {
        assertFalse(nextFollowLatest(false, userScrollEnded = false, atBottom = true, tappedNewest = false))
    }
}
