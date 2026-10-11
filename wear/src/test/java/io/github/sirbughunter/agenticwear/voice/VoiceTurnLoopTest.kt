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
    fun `detector ends after speech then two seconds of silence`() {
        val d = SpeechEndpointDetector(0)
        var t = 0L
        while (t < 1_000) { t += 100; assertEquals(EndpointDecision.CONTINUE, d.update(0.6f, t)) }
        var ended = -1L
        while (t < 6_000 && ended < 0) { t += 100; if (d.update(0.02f, t) == EndpointDecision.END_OF_SPEECH) ended = t }
        assertEquals(LOOP_IGNORE_SILENCE_MS + LOOP_SILENCE_END_MS, ended)
    }

    @Test
    fun `a mid-sentence pause shorter than the silence window does not end the turn`() {
        val d = SpeechEndpointDetector(0)
        var t = 0L
        while (t < 800) { t += 100; d.update(0.6f, t) }
        while (t < 800 + 1_800) { t += 100; assertEquals(EndpointDecision.CONTINUE, d.update(0.02f, t)) }
        t += 100; assertEquals(EndpointDecision.CONTINUE, d.update(0.6f, t))
    }

    @Test
    fun `hysteresis keeps a soft tail counted as speech`() {
        val d = SpeechEndpointDetector(0)
        var t = 0L
        while (t < 800) { t += 100; d.update(0.6f, t) }
        while (t < 6_000) { t += 100; assertEquals(EndpointDecision.CONTINUE, d.update(0.15f, t)) }
    }

    @Test
    fun `silence in the first 1_5 seconds is ignored and short speech never counts`() {
        val d = SpeechEndpointDetector(0)
        var t = 0L
        d.update(0.6f, 100); d.update(0.6f, 200); d.update(0.6f, 300); t = 300
        while (t < 10_000) { t += 100; assertEquals(EndpointDecision.CONTINUE, d.update(0.0f, t)) }
    }

    @Test
    fun `barge in needs 300 ms of continuous loud audio`() {
        val b = BargeInDetector()
        assertEquals(false, b.update(0.5f, 0)); assertEquals(false, b.update(0.5f, 200))
        assertEquals(false, b.update(0.0f, 250))
        assertEquals(false, b.update(0.5f, 300)); assertEquals(false, b.update(0.5f, 500))
        assertEquals(true, b.update(0.5f, 600))
    }

    @Test
    fun `barge in during speaking restarts listening and reply timeout only applies while waiting`() {
        assertEquals(VoiceLoopStep(VoiceLoopPhase.STARTING, VoiceLoopEffect.Listen), reduceVoiceLoop(VoiceLoopPhase.SPEAKING, VoiceLoopEvent.BargeIn))
        assertEquals(VoiceLoopPhase.WAITING, reduceVoiceLoop(VoiceLoopPhase.WAITING, VoiceLoopEvent.BargeIn).phase)
        assertEquals(VoiceLoopStep(VoiceLoopPhase.IDLE, VoiceLoopEffect.Fail(LOOP_REPLY_TIMEOUT_MESSAGE)), reduceVoiceLoop(VoiceLoopPhase.WAITING, VoiceLoopEvent.ReplyTimeout))
        assertEquals(VoiceLoopPhase.SPEAKING, reduceVoiceLoop(VoiceLoopPhase.SPEAKING, VoiceLoopEvent.ReplyTimeout).phase)
    }

    @Test
    fun `continuous speech is cut at the max turn length`() {
        val d = SpeechEndpointDetector(0)
        var t = 0L
        while (t < LOOP_MAX_TURN_MS - 100) { t += 100; assertEquals(EndpointDecision.CONTINUE, d.update(0.7f, t)) }
        assertEquals(EndpointDecision.MAX_LENGTH, d.update(0.7f, LOOP_MAX_TURN_MS))
    }
}
