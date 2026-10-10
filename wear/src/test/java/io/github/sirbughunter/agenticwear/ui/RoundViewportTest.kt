package io.github.sirbughunter.agenticwear.ui

import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.hypot

class RoundViewportTest {
    @Test fun restingContentInsetsKeepControlsInsideSmallAndLargerRoundDisplays() {
        for (size in listOf(227f, 260f, 300f)) {
            val inset = roundViewportInsets(size, size)
            for (x in listOf(inset.horizontal, size - inset.horizontal)) {
                for (y in listOf(inset.top, size - inset.bottom)) {
                    assertTrue(hypot(x - size / 2, y - size / 2) < size / 2)
                }
            }
            assertTrue(size - inset.horizontal * 2 > 48f * 2 + 6f)
            assertTrue(size - inset.top - inset.bottom > 48f * 2)
        }
    }
}
