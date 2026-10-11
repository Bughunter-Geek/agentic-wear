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
        assertEquals(VoiceLoopStep(VoiceLoopPhase.STARTING, VoiceLoopEffect.Listen), step)
        step = reduceVoiceLoop(step.phase, VoiceLoopEvent.RecordingStarted)
        assertEquals(VoiceLoopStep(VoiceLoopPhase.LISTENING, VoiceLoopEffect.None), step)
        step = reduceVoiceLoop(step.phase, VoiceLoopEvent.Heard(" hello "))
        assertEquals(VoiceLoopStep(VoiceLoopPhase.SENDING, VoiceLoopEffect.Submit("hello")), step)
        step = reduceVoiceLoop(step.phase, VoiceLoopEvent.Submitted)
        assertEquals(VoiceLoopPhase.WAITING, step.phase)
        step = reduceVoiceLoop(step.phase, VoiceLoopEvent.Reply("answer", quiet = false))
        assertEquals(VoiceLoopStep(VoiceLoopPhase.SPEAKING, VoiceLoopEffect.Speak("answer")), step)
        step = reduceVoiceLoop(step.phase, VoiceLoopEvent.SpeechDone)
        assertEquals(VoiceLoopStep(VoiceLoopPhase.STARTING, VoiceLoopEffect.Listen), step)
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

    @Test
    fun `starting only becomes listening when recording started`() {
        for (e in listOf(VoiceLoopEvent.Start, VoiceLoopEvent.Heard("x"), VoiceLoopEvent.EndOfSpeech(), VoiceLoopEvent.SpeechDone)) {
            assertEquals(VoiceLoopStep(VoiceLoopPhase.STARTING, VoiceLoopEffect.None), reduceVoiceLoop(VoiceLoopPhase.STARTING, e))
        }
        assertEquals(VoiceLoopPhase.LISTENING, reduceVoiceLoop(VoiceLoopPhase.STARTING, VoiceLoopEvent.RecordingStarted).phase)
        assertEquals("Starting microphone…", voiceLoopLabel(VoiceLoopPhase.STARTING))
    }

    @Test
    fun `start timeout fails with a clear message only while starting`() {
        assertEquals(
            VoiceLoopStep(VoiceLoopPhase.IDLE, VoiceLoopEffect.Fail(LOOP_START_FAILED_MESSAGE)),
            reduceVoiceLoop(VoiceLoopPhase.STARTING, VoiceLoopEvent.StartTimeout),
        )
        assertEquals(VoiceLoopPhase.LISTENING, reduceVoiceLoop(VoiceLoopPhase.LISTENING, VoiceLoopEvent.StartTimeout).phase)
        assertEquals(VoiceLoopPhase.IDLE, reduceVoiceLoop(VoiceLoopPhase.IDLE, VoiceLoopEvent.StartTimeout).phase)
    }

    @Test
    fun `end of speech while listening finishes the turn like a tap`() {
        assertEquals(
            VoiceLoopStep(VoiceLoopPhase.LISTENING, VoiceLoopEffect.FinishListening),
            reduceVoiceLoop(VoiceLoopPhase.LISTENING, VoiceLoopEvent.EndOfSpeech()),
        )
        assertEquals(VoiceLoopEffect.None, reduceVoiceLoop(VoiceLoopPhase.WAITING, VoiceLoopEvent.EndOfSpeech(true)).effect)
    }

    @Test
    fun `detector ends after speech then silence`() {
        val d = SpeechEndpointDetector(0)
        var t = 0L
        var last = EndpointDecision.CONTINUE
        while (t < 400) { t += 100; last = d.update(0.6f, t); assertEquals(EndpointDecision.CONTINUE, last) }
        var ended = -1L
        while (t < 3_000 && ended < 0) { t += 100; if (d.update(0.02f, t) == EndpointDecision.END_OF_SPEECH) ended = t }
        assertEquals(500L + LOOP_SILENCE_END_MS, ended)
    }

    @Test
    fun `detector never ends on silence without speech or on a short blip`() {
        val d = SpeechEndpointDetector(0)
        var t = 0L
        while (t < 10_000) { t += 100; assertEquals(EndpointDecision.CONTINUE, d.update(0.0f, t)) }
        val blip = SpeechEndpointDetector(0)
        t = 0
        blip.update(0.6f, 100)
        t = 100
        while (t < 5_000) { t += 100; assertEquals(EndpointDecision.CONTINUE, blip.update(0.0f, t)) }
    }

    @Test
    fun `continuous speech is cut at the max turn length`() {
        val d = SpeechEndpointDetector(0)
        var t = 0L
        while (t < LOOP_MAX_TURN_MS - 100) { t += 100; assertEquals(EndpointDecision.CONTINUE, d.update(0.7f, t)) }
        assertEquals(EndpointDecision.MAX_LENGTH, d.update(0.7f, LOOP_MAX_TURN_MS))
    }
}
