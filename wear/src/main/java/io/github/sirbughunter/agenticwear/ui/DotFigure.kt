package io.github.sirbughunter.agenticwear.ui

import android.animation.ValueAnimator
import androidx.annotation.DrawableRes
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import io.github.sirbughunter.agenticwear.R
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/** The felt dot figures; the user picks the one that matches their Dot in Settings. */
internal enum class DotAvatar(val label: String, @param:DrawableRes val res: Int, val glow: Color) {
    EMBER("Ember", R.drawable.dot_ember, Color(0xFFE8643C)),
    FELIPE("Felipe", R.drawable.dot_felipe, Color(0xFF3BA0E8)),
    ALFRED("Alfred", R.drawable.dot_alfred, Color(0xFFF2C94C)),
    IGGY("Iggy", R.drawable.dot_iggy, Color(0xFFC94BD8)),
    TODD("Todd", R.drawable.dot_todd, Color(0xFFC6E85A)),
    SUNNY("Sunny", R.drawable.dot_sunny, Color(0xFFF0D84A)),
    GEM("Gem", R.drawable.dot_gem, Color(0xFF4A90E8)),
    BUN("Bun", R.drawable.dot_bun, Color(0xFFF08CA0));

    companion object {
        fun fromLabel(label: String?): DotAvatar = entries.firstOrNull { it.label == label } ?: FELIPE
    }
}

internal enum class DotMood { IDLE, THINKING, RESPONDING, NEEDS, FROZEN }

private const val TAU = 2f * PI.toFloat()

/**
 * An animated dot. Idle breathes and floats; thinking tilts side to side with a thought
 * bubble of three bouncing dots; responding bounces with squash and stretch; needs-you hops.
 * Moods cross-fade, so a change never snaps. Reduced motion shows the still figure.
 */
@Composable
internal fun DotFigure(avatar: DotAvatar, mood: DotMood, modifier: Modifier = Modifier) {
    val reducedMotion = !ValueAnimator.areAnimatorsEnabled()
    val clock = remember { mutableFloatStateOf(0f) }
    val think by animateFloatAsState(if (mood == DotMood.THINKING) 1f else 0f, tween(420), label = "think")
    val respond by animateFloatAsState(if (mood == DotMood.RESPONDING) 1f else 0f, tween(260), label = "respond")
    val needs by animateFloatAsState(if (mood == DotMood.NEEDS) 1f else 0f, tween(260), label = "needs")
    val frozen by animateFloatAsState(if (mood == DotMood.FROZEN) 1f else 0f, tween(400), label = "frozen")
    LaunchedEffect(reducedMotion, mood) {
        if (reducedMotion || mood == DotMood.FROZEN) return@LaunchedEffect
        var last = 0L
        fun advance(now: Long) {
            if (last != 0L) clock.floatValue = (clock.floatValue + ((now - last) / 1_000_000_000f).coerceAtMost(.08f)) % 1_000f
            last = now
        }
        while (true) {
            // Idle breathing is slow; ~25 fps looks the same and saves battery.
            if (mood == DotMood.IDLE) { delay(40); advance(System.nanoTime()) } else withFrameNanos(::advance)
        }
    }
    val saturation = remember(frozen) { ColorMatrix().apply { setToSaturation(1f - .8f * frozen) } }

    Box(modifier) {
        // Glow and ground shadow.
        Canvas(Modifier.fillMaxSize()) {
            val t = clock.floatValue
            val w = size.minDimension
            val glow = (1f - frozen) * (.16f + think * (.14f + .1f * sin(TAU * t / 1.6f)) + respond * .3f + needs * .22f)
            if (glow > .01f) drawCircle(
                Brush.radialGradient(listOf(avatar.glow.copy(alpha = glow), Color.Transparent), center = center, radius = w * .78f),
                radius = w * .78f, center = center,
            )
            if (w > 30f) {
                val lift = lift(t, think, respond, needs)
                val shadowW = w * .5f * (1f - lift * 2.2f)
                drawOval(
                    Brush.radialGradient(listOf(Color.Black.copy(alpha = .5f), Color.Transparent), center = Offset(center.x, w * .97f), radius = shadowW / 2),
                    topLeft = Offset(center.x - shadowW / 2, w * .93f), size = Size(shadowW, w * .08f),
                )
            }
        }
        Image(
            painterResource(avatar.res), contentDescription = null,
            colorFilter = if (frozen > .01f) ColorFilter.colorMatrix(saturation) else null,
            modifier = Modifier.fillMaxSize().graphicsLayer {
                val t = clock.floatValue
                transformOrigin = TransformOrigin(.5f, .9f)
                val breathe = .022f * sin(TAU * t / 4.2f) + think * .018f * sin(TAU * t / 2.2f)
                val bounce = (t / .82f) % 1f
                val squash = respond * .06f * kotlin.math.cos(TAU * bounce)
                scaleX = 1f + breathe + squash
                scaleY = 1f + breathe - squash
                rotationZ = think * 7f * sin(TAU * t / 2.6f)
                translationY = -lift(t, think, respond, needs) * size.height
                alpha = 1f - .3f * frozen
            },
        )
        // Thought bubble: three dots that bounce in turn while thinking.
        if (think > .01f) Canvas(Modifier.fillMaxSize()) {
            val t = clock.floatValue
            val w = size.minDimension
            if (w < 20f) return@Canvas
            val r = (w * .055f).coerceAtLeast(1.6f)
            for (i in 0..2) {
                val hop = abs(sin(TAU * (t / 1.3f) / 2f - i * .45f))
                drawCircle(
                    Color.White.copy(alpha = think * (.45f + .55f * hop)),
                    radius = r,
                    center = Offset(w * (.66f + i * .14f), w * .04f - hop * w * .07f),
                )
            }
        }
    }
}

/** Upward offset as a fraction of the figure's height. */
private fun lift(t: Float, think: Float, respond: Float, needs: Float): Float {
    val float = .012f * (.5f + .5f * sin(TAU * t / 4.2f))
    val bob = respond * .07f * abs(sin(PI.toFloat() * ((t / .82f) % 1f)))
    val hopPhase = (t / 1.7f) % 1f
    val hop = needs * if (hopPhase < .36f) .1f * sin(PI.toFloat() * hopPhase / .36f) else 0f
    return float + think * .015f + bob + hop
}
