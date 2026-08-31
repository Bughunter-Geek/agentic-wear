package io.github.sirbughunter.agenticwear.ui

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoundControlGeometryTest {
    @Test
    fun `cancel field excludes the inner orb and accepts its surrounding area`() {
        assertFalse(isCancelFieldTap(distance = 30f, innerRadius = 38f, outerRadius = 58f))
        assertTrue(isCancelFieldTap(distance = 38f, innerRadius = 38f, outerRadius = 58f))
        assertTrue(isCancelFieldTap(distance = 50f, innerRadius = 38f, outerRadius = 58f))
        assertFalse(isCancelFieldTap(distance = 59f, innerRadius = 38f, outerRadius = 58f))
    }

    @Test
    fun `round close target moves inside the top chord`() {
        val endPadding = roundSafeEndPadding(
            screenWidth = 228.dp,
            screenHeight = 228.dp,
            centerY = 50.dp,
            targetRadius = 22.dp,
            margin = 4.dp,
        )

        assertTrue(endPadding >= 30.dp)
    }
}
