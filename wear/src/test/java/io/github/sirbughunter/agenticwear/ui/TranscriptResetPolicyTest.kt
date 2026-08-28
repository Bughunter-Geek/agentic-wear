package io.github.sirbughunter.agenticwear.ui

import io.github.sirbughunter.agenticwear.model.Transcript
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class TranscriptResetPolicyTest {
    @Test
    fun `returning from transcript leaves voice interaction idle`() {
        val reset = resetForNewTranscription(
            WearUiState(
                screen = WearScreen.TRANSCRIPT,
                transcript = Transcript("request-1", "Hello", "thread-1"),
                pending = true,
                recording = true,
                transcribing = true,
                voiceLevel = 0.8f,
                error = "Old error",
            ),
        )

        assertEquals(WearScreen.HOME, reset.screen)
        assertNull(reset.transcript)
        assertFalse(reset.pending)
        assertFalse(reset.recording)
        assertFalse(reset.transcribing)
        assertEquals(0f, reset.voiceLevel, 0f)
        assertNull(reset.error)
    }
}
