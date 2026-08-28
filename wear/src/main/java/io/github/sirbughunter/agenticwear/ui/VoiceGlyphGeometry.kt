package io.github.sirbughunter.agenticwear.ui

import kotlin.math.abs
import kotlin.math.sqrt

internal object VoiceGlyphGeometry {
    const val BAR_COUNT = 3
    const val ARC_INSET_FRACTION = 0.08f
    const val ARC_DIAMETER_FRACTION = 0.84f
    const val ARC_STROKE_FRACTION = 0.08f
    const val BAR_STROKE_FRACTION = 0.11f
    const val MINIMUM_CLEARANCE_FRACTION = 0.03f

    private const val ARC_ACTIVITY_SCALE = 0.18f

    fun arcScale(activity: Float): Float = 1f + normalized(activity) * ARC_ACTIVITY_SCALE

    fun barXFraction(index: Int): Float = when (index) {
        0 -> 0.32f
        1 -> 0.50f
        2 -> 0.68f
        else -> error("Voice glyph bar index must be 0..2")
    }

    fun barHeightFraction(index: Int, activity: Float): Float {
        val level = normalized(activity)
        return when (index) {
            0 -> 0.18f + level * 0.44f
            1 -> 0.32f + level * 0.40f
            2 -> 0.22f + level * 0.40f
            else -> error("Voice glyph bar index must be 0..2")
        }
    }

    fun minimumBarToArcClearanceFraction(activity: Float): Float {
        val innerArcRadius =
            (ARC_DIAMETER_FRACTION - ARC_STROKE_FRACTION) / 2f * arcScale(activity)
        val barCapRadius = BAR_STROKE_FRACTION / 2f
        return (0 until BAR_COUNT).minOf { index ->
            val horizontalDistance = abs(barXFraction(index) - 0.5f)
            val halfHeight = barHeightFraction(index, activity) / 2f
            val barOuterRadius = sqrt(
                horizontalDistance * horizontalDistance + halfHeight * halfHeight,
            ) + barCapRadius
            innerArcRadius - barOuterRadius
        }
    }

    private fun normalized(activity: Float): Float = activity.coerceIn(0f, 1f)
}
