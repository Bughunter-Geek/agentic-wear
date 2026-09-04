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
