package io.github.sirbughunter.agenticwear.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceGlyphGeometryTest {
    @Test
    fun `open arc expands smoothly from silence through full speech`() {
        assertEquals(1f, VoiceGlyphGeometry.arcScale(0f), 0f)
        assertTrue(VoiceGlyphGeometry.arcScale(0.5f) > VoiceGlyphGeometry.arcScale(0f))
        assertTrue(VoiceGlyphGeometry.arcScale(1f) > VoiceGlyphGeometry.arcScale(0.5f))
    }

    @Test
    fun `rounded waveform bars always clear the inner arc stroke`() {
        for (step in 0..1_000) {
            val activity = step / 1_000f
            val clearance = VoiceGlyphGeometry.minimumBarToArcClearanceFraction(activity)
            assertTrue(
                "activity=$activity clearance=$clearance",
                clearance >= VoiceGlyphGeometry.MINIMUM_CLEARANCE_FRACTION,
            )
        }
    }
}
