package io.github.sirbughunter.agenticwear.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class EffortStepTest {
    @Test
    fun `steps are clamped and labelled`() {
        assertEquals(1, stepEffortIndex(0, 1, 5))
        assertEquals(0, stepEffortIndex(0, -1, 5))
        assertEquals(4, stepEffortIndex(4, 1, 5))
        assertEquals(0, stepEffortIndex(3, 1, 0))
        assertEquals("2 of 5", effortPositionLabel(1, 5))
    }
}
