package io.github.sirbughunter.agenticwear.ui

import android.animation.ValueAnimator
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import kotlin.math.sqrt

private const val WaveBars = 17

/**
 * Dictation waveform. While recording, each bar is a real recent microphone
 * level sample scrolling right to left; silence stays flat. While
 * transcribing, the bars settle and a soft travelling pulse shows progress.
 */
@Composable
internal fun DictationWaveform(level: Float, transcribing: Boolean, modifier: Modifier = Modifier) {
    val reducedMotion = !ValueAnimator.areAnimatorsEnabled()
    val samples = remember { mutableStateListOf<Float>().apply { repeat(WaveBars) { add(0f) } } }
    val latest by rememberUpdatedState(level.takeIf { it.isFinite() }?.coerceIn(0f, 1f) ?: 0f)
    LaunchedEffect(transcribing) {
        if (transcribing) return@LaunchedEffect
        while (true) {
            samples.removeAt(0)
            samples.add(sqrt(latest))
            delay(70)
        }
    }
    val transition = rememberInfiniteTransition(label = "transcribing pulse")
    val pulse by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(1300, easing = LinearEasing)), label = "pulse")
    Canvas(modifier) {
        val gap = size.width / (WaveBars * 2f - 1f)
        val barWidth = gap
        val mid = size.height / 2f
        for (i in 0 until WaveBars) {
            val x = i * gap * 2f + barWidth / 2f
            val edgeFade = 1f - abs(i - (WaveBars - 1) / 2f) / ((WaveBars - 1) / 2f) * 0.65f
            val fraction = if (transcribing) {
                val wave = if (reducedMotion) 0f else sin(((i / WaveBars.toFloat()) - pulse) * 2f * PI.toFloat()).coerceAtLeast(0f)
                0.08f + 0.12f * wave
            } else {
                (0.08f + 0.92f * samples[i]).coerceIn(0.08f, 1f)
            }
            val half = (size.height * fraction) / 2f
            drawLine(
                color = Aw.Text.copy(alpha = edgeFade.coerceIn(0.3f, 1f)),
                start = Offset(x, mid - half),
                end = Offset(x, mid + half),
                strokeWidth = barWidth,
                cap = StrokeCap.Round,
            )
        }
    }
}
