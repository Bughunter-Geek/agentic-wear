package io.github.sirbughunter.agenticwear

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceSessionScreenPolicyTest {
    @Test
    fun keepsScreenOnWhileRecording() {
        assertTrue(
            keepScreenOnForVoiceSession(
                recording = true,
                transcribing = false,
                transcriptionElapsedMillis = null,
            ),
        )
    }

    @Test
    fun keepsScreenOnWhileWaitingForTranscript() {
        assertTrue(
            keepScreenOnForVoiceSession(
                recording = false,
                transcribing = true,
                transcriptionElapsedMillis = TRANSCRIBING_SCREEN_AWAKE_LIMIT_MS - 1,
            ),
        )
    }

    @Test
    fun releasesScreenWhenTranscriptWaitExceedsLimit() {
        assertFalse(
            keepScreenOnForVoiceSession(
                recording = false,
                transcribing = true,
                transcriptionElapsedMillis = TRANSCRIBING_SCREEN_AWAKE_LIMIT_MS,
            ),
        )
    }

    @Test
    fun releasesScreenWhenVoiceSessionEnds() {
        assertFalse(
            keepScreenOnForVoiceSession(
                recording = false,
                transcribing = false,
                transcriptionElapsedMillis = null,
            ),
        )
    }
}
