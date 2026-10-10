package io.github.sirbughunter.agenticwear.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

internal data class RoundViewportInsets(val horizontal: Float, val top: Float, val bottom: Float)

/** Content resting bounds; scrolling uses the full display viewport. */
internal fun roundViewportInsets(width: Float, height: Float): RoundViewportInsets {
    val top = height * 0.14f
    val bottom = height * 0.18f
    val radius = min(width, height) / 2f
    val vertical = max(abs(top - height / 2f), abs(height / 2f - bottom))
    val halfChord = sqrt(max(0f, radius * radius - vertical * vertical))
    return RoundViewportInsets(max(0f, width / 2f - halfChord + 3f), top, bottom)
}

/** Horizontal content width only: never inset or clip the round scroll viewport vertically. */
@Composable
internal fun Modifier.roundSafeViewport(): Modifier {
    val configuration = LocalConfiguration.current
    if (!configuration.isScreenRound) return padding(horizontal = 18.dp, vertical = 12.dp).clipToBounds()
    val insets = roundViewportInsets(configuration.screenWidthDp.toFloat(), configuration.screenHeightDp.toFloat())
    return padding(horizontal = insets.horizontal.dp)
}

/** Place after the scroll modifier so these end margins move with the content. */
@Composable
internal fun Modifier.roundScrollContentPadding(): Modifier {
    val config = LocalConfiguration.current
    if (!config.isScreenRound) return padding(vertical = 12.dp)
    val insets = roundViewportInsets(config.screenWidthDp.toFloat(), config.screenHeightDp.toFloat())
    return padding(top = insets.top.dp, bottom = insets.bottom.dp)
}
