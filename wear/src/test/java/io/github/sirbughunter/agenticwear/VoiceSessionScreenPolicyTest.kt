package io.github.sirbughunter.agenticwear

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceSessionScreenPolicyTest {
    @Test
    fun keepsScreenOnWhileRecording() {
        assertTrue(keepScreenOnForVoiceSession(recording = true, transcribing = false))
    }

    @Test
    fun keepsScreenOnWhileWaitingForTranscript() {
        assertTrue(keepScreenOnForVoiceSession(recording = false, transcribing = true))
    }

    @Test
    fun releasesScreenWhenVoiceSessionEnds() {
        assertFalse(keepScreenOnForVoiceSession(recording = false, transcribing = false))
    }
}
