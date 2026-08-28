package io.github.sirbughunter.agenticwear.data

import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import org.junit.Assert.assertEquals
import org.junit.Test

class AppPreferencesTest {
    @Test
    fun `new installs default to private bridge whisper`() {
        assertEquals(TranscriptionEngine.BRIDGE_WHISPER, storedTranscriptionEngine(null))
    }

    @Test
    fun `legacy GPT preference migrates to private bridge whisper`() {
        assertEquals(TranscriptionEngine.BRIDGE_WHISPER, storedTranscriptionEngine("GPT_TRANSCRIBE"))
    }

    @Test
    fun `explicit device speech preference is preserved`() {
        assertEquals(TranscriptionEngine.DEVICE_SPEECH, storedTranscriptionEngine("DEVICE_SPEECH"))
    }
}
