package io.github.sirbughunter.agenticwear.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceActivityTest {
    @Test
    fun `silence remains perfectly still`() {
        assertEquals(0f, voiceActivityLevel(0), 0f)
        assertEquals(0f, voiceActivityLevel(1_000), 0f)
        assertEquals(0f, rmsVoiceActivityLevel(-2f), 0f)
    }

    @Test
    fun `speech activity grows monotonically and stays bounded`() {
        val quiet = voiceActivityLevel(2_000)
        val speaking = voiceActivityLevel(12_000)
        assertTrue(quiet > 0f)
        assertTrue(speaking > quiet)
        assertEquals(1f, voiceActivityLevel(32_767), 0f)
        assertEquals(1f, voiceActivityLevel(Int.MAX_VALUE), 0f)
    }

    @Test
    fun `device speech rms maps only audible levels`() {
        assertTrue(rmsVoiceActivityLevel(5f) > 0f)
        assertEquals(1f, rmsVoiceActivityLevel(20f), 0f)
    }
}
