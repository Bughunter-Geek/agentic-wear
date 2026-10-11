package io.github.sirbughunter.agenticwear.voice

import io.github.sirbughunter.agenticwear.model.ChatMessage
import io.github.sirbughunter.agenticwear.model.ChatPhase
import io.github.sirbughunter.agenticwear.model.ChatRole
import io.github.sirbughunter.agenticwear.model.ChatSnapshot
import io.github.sirbughunter.agenticwear.model.SessionStatus
import io.github.sirbughunter.agenticwear.model.SubmissionPhase
import io.github.sirbughunter.agenticwear.model.SubmittedTurn
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceTurnLoopTest {
    @Test
    fun `full turn cycles listen send wait speak listen`() {
        var step = reduceVoiceLoop(VoiceLoopPhase.IDLE, VoiceLoopEvent.Start)
        assertEquals(VoiceLoopStep(VoiceLoopPhase.LISTENING, VoiceLoopEffect.Listen), step)
        step = reduceVoiceLoop(step.phase, VoiceLoopEvent.Heard(" hello "))
        assertEquals(VoiceLoopStep(VoiceLoopPhase.SENDING, VoiceLoopEffect.Submit("hello")), step)
        step = reduceVoiceLoop(step.phase, VoiceLoopEvent.Submitted)
        assertEquals(VoiceLoopPhase.WAITING, step.phase)
        step = reduceVoiceLoop(step.phase, VoiceLoopEvent.Reply("answer", quiet = false))
        assertEquals(VoiceLoopStep(VoiceLoopPhase.SPEAKING, VoiceLoopEffect.Speak("answer")), step)
        step = reduceVoiceLoop(step.phase, VoiceLoopEvent.SpeechDone)
        assertEquals(VoiceLoopStep(VoiceLoopPhase.LISTENING, VoiceLoopEffect.Listen), step)
    }

    @Test
    fun `stop from every active state ends the loop and stopping idle is a no-op`() {
        for (phase in VoiceLoopPhase.values().filter { it != VoiceLoopPhase.IDLE }) {
            assertEquals(VoiceLoopStep(VoiceLoopPhase.IDLE, VoiceLoopEffect.StopAll), reduceVoiceLoop(phase, VoiceLoopEvent.Stop))
        }
        assertEquals(VoiceLoopStep(VoiceLoopPhase.IDLE, VoiceLoopEffect.None), reduceVoiceLoop(VoiceLoopPhase.IDLE, VoiceLoopEvent.Stop))
    }

    @Test
    fun `errors stop the loop with the message from any active state`() {
        for (phase in VoiceLoopPhase.values().filter { it != VoiceLoopPhase.IDLE }) {
            assertEquals(VoiceLoopStep(VoiceLoopPhase.IDLE, VoiceLoopEffect.Fail("boom")), reduceVoiceLoop(phase, VoiceLoopEvent.Fail("boom")))
        }
        assertEquals(VoiceLoopEffect.None, reduceVoiceLoop(VoiceLoopPhase.IDLE, VoiceLoopEvent.Fail("x")).effect)
        assertTrue(reduceVoiceLoop(VoiceLoopPhase.LISTENING, VoiceLoopEvent.Heard("  ")).effect is VoiceLoopEffect.Fail)
    }

    @Test
    fun `do not disturb shows text only and ends the loop`() {
        assertEquals(
            VoiceLoopStep(VoiceLoopPhase.IDLE, VoiceLoopEffect.StopAll),
            reduceVoiceLoop(VoiceLoopPhase.WAITING, VoiceLoopEvent.Reply("answer", quiet = true)),
        )
    }

    @Test
    fun `out-of-order events are ignored`() {
        assertEquals(VoiceLoopPhase.IDLE, reduceVoiceLoop(VoiceLoopPhase.IDLE, VoiceLoopEvent.SpeechDone).phase)
        assertEquals(VoiceLoopPhase.WAITING, reduceVoiceLoop(VoiceLoopPhase.WAITING, VoiceLoopEvent.Heard("x")).phase)
        assertEquals(VoiceLoopPhase.SPEAKING, reduceVoiceLoop(VoiceLoopPhase.SPEAKING, VoiceLoopEvent.Start).phase)
    }

    @Test
    fun `final reply requires a completed submission with a matching final answer`() {
        val sub = SubmittedTurn("r", "t", "hi", 1L, SubmissionPhase.COMPLETED, nativeTurnId = "turn1")
        fun chat(vararg m: ChatMessage) = ChatSnapshot("t", "T", SessionStatus.IDLE, emptyList(), 1L, messages = m.toList())
        val commentary = ChatMessage("a", "turn1", ChatRole.ASSISTANT, "thinking", ChatPhase.COMMENTARY)
        val final = ChatMessage("b", "turn1", ChatRole.ASSISTANT, "done", ChatPhase.FINAL_ANSWER)
        val other = ChatMessage("c", "turn0", ChatRole.ASSISTANT, "old", ChatPhase.FINAL_ANSWER)
        assertEquals("done", finalReplyFor(sub, chat(other, commentary, final)))
        assertNull(finalReplyFor(sub, chat(other, commentary)))
        assertNull(finalReplyFor(sub.copy(phase = SubmissionPhase.RUNNING), chat(final)))
        assertNull(finalReplyFor(sub, chat(final).copy(threadId = "x")))
        assertNull(finalReplyFor(null, chat(final)))
    }

    @Test
    fun `speech text strips markdown and caps length`() {
        val spoken = speechPlainText("# Title\n\n**Bold** and `code` [link](http://x.y)\n- item one\n```\nsecret()\n```")
        assertTrue(spoken, !spoken.contains("secret") && !spoken.contains("*") && !spoken.contains("`") && !spoken.contains("http"))
        assertTrue(spoken.startsWith("Title"))
        val long = speechPlainText("word ".repeat(1000))
        assertTrue(long.length <= MAX_SPOKEN_CHARS + 1)
    }
}
