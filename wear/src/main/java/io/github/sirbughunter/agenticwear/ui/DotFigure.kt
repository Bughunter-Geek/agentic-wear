package io.github.sirbughunter.agenticwear.ui

import android.animation.ValueAnimator
import androidx.annotation.DrawableRes
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.animation.togetherWith
import androidx.compose.ui.unit.dp
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

internal enum class DotMood { IDLE, THINKING, RESPONDING, NEEDS, FROZEN, LISTENING, SPEAKING }

/**
 * The emoji a Dot can react with (ChatGPT's react_to_user_message set). The figure floats one
 * beside itself, bobbing and glowing like the desktop companion's lamp.
 */
internal val DOT_REACTIONS = listOf("👍", "✅", "💡", "🔍", "🚀", "🤝", "🙌", "🎉", "❤️", "🤔", "👀", "😂", "🙏", "🔥", "✨", "🫡", "🪄", "🧪", "🐛", "🫠", "🍳", "🧹")

private val THINKING_EXPRESSIONS = listOf("💡", "🔍", "🤔", "🧪")

/** The expression for a mood when the Dot hasn't chosen its own; thinking cycles through ideas. */
internal fun defaultDotExpression(mood: DotMood, seconds: Float): String? = when (mood) {
    DotMood.THINKING -> THINKING_EXPRESSIONS[((seconds / 3.6f).toInt()).mod(THINKING_EXPRESSIONS.size)]
    DotMood.RESPONDING -> "✨"
    DotMood.NEEDS -> "👀"
    else -> null
}

private fun expressionGlow(emoji: String): Color = when (emoji) {
    "💡", "✨", "🔥", "🎉", "🚀" -> Color(0xFFFFC85A)
    "❤️" -> Color(0xFFFF6F8E)
    "🧪", "🪄" -> Color(0xFFB98CFF)
    else -> Color(0xFFBFD8FF)
}

private const val TAU = 2f * PI.toFloat()

/**
 * An animated dot. Idle breathes and floats; thinking tilts side to side with a thought
 * bubble of three bouncing dots; responding bounces with squash and stretch; needs-you hops.
 * Moods cross-fade, so a change never snaps. Reduced motion shows the still figure.
 */
@Composable
internal fun DotFigure(
    avatar: DotAvatar,
    mood: DotMood,
    modifier: Modifier = Modifier,
    userLevel: Float = 0f,
    agentLevel: Float = 0f,
    expression: String? = null,
) {
    val reducedMotion = !ValueAnimator.areAnimatorsEnabled()
    val clock = remember { mutableFloatStateOf(0f) }
    val think by animateFloatAsState(if (mood == DotMood.THINKING) 1f else 0f, tween(420), label = "think")
    val speakTarget = when (mood) {
        DotMood.RESPONDING -> 1f
        DotMood.SPEAKING -> .35f + .65f * kotlin.math.sqrt(agentLevel.takeIf { it.isFinite() }?.coerceIn(0f, 1f) ?: 0f)
        else -> 0f
    }
    val respond by animateFloatAsState(speakTarget, androidx.compose.animation.core.spring(dampingRatio = 1f, stiffness = 260f), label = "respond")
    val listen by animateFloatAsState(
        if (mood == DotMood.LISTENING) kotlin.math.sqrt(userLevel.takeIf { it.isFinite() }?.coerceIn(0f, 1f) ?: 0f) else 0f,
        androidx.compose.animation.core.spring(dampingRatio = .45f, stiffness = 420f), label = "listen")
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
                scaleX = 1f + breathe + squash + .12f * listen
                scaleY = 1f + breathe - squash + .12f * listen
                rotationZ = think * 7f * sin(TAU * t / 2.6f)
                translationY = -lift(t, think, respond, needs) * size.height
                alpha = 1f - .3f * frozen
            },
        )
        // Only recomposes when the chosen expression changes, not every frame.
        val autoExpression by remember(mood) { androidx.compose.runtime.derivedStateOf { defaultDotExpression(mood, clock.floatValue) } }
        val shown = if (mood == DotMood.FROZEN) null else expression ?: autoExpression
        androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
            if (shown != null && maxWidth >= 36.dp) DotExpression(shown, clock, maxWidth)
            else if (think > .01f && maxWidth >= 20.dp) Canvas(Modifier.fillMaxSize()) {
                // Small figures: a thought bubble of three dots that bounce in turn.
                val t = clock.floatValue
                val w = size.minDimension
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
}

/**
 * An emoji floating at the figure's shoulder: it pops in, bobs up and down and glows softly.
 * Only shown on figures big enough to read it (≥ 36 dp).
 */
@Composable
private fun DotExpression(emoji: String, clock: androidx.compose.runtime.MutableFloatState, width: androidx.compose.ui.unit.Dp) {
    run {
        val maxWidth = width
        val side = maxWidth * .34f
        androidx.compose.animation.AnimatedContent(
            targetState = emoji,
            transitionSpec = {
                (androidx.compose.animation.scaleIn(androidx.compose.animation.core.spring(dampingRatio = .5f, stiffness = 380f), initialScale = .3f) +
                    androidx.compose.animation.fadeIn(tween(160))) togetherWith
                    (androidx.compose.animation.scaleOut(tween(160), targetScale = .6f) + androidx.compose.animation.fadeOut(tween(160)))
            },
            label = "dot expression",
            modifier = Modifier.offset(x = maxWidth * .78f, y = -maxWidth * .02f).size(side),
        ) { shown ->
            val glow = expressionGlow(shown)
            Box(Modifier.fillMaxSize().graphicsLayer {
                val t = clock.floatValue
                translationY = -size.height * (.1f + .1f * sin(TAU * t / 1.8f))
                rotationZ = 6f * sin(TAU * t / 3.4f)
            }, contentAlignment = androidx.compose.ui.Alignment.Center) {
                Canvas(Modifier.fillMaxSize()) {
                    val pulse = .5f + .5f * sin(TAU * clock.floatValue / 1.8f)
                    drawCircle(
                        Brush.radialGradient(listOf(glow.copy(alpha = .35f + .25f * pulse), Color.Transparent), center = center, radius = size.minDimension * .9f),
                        radius = size.minDimension * .9f, center = center,
                    )
                }
                androidx.wear.compose.material3.Text(shown, fontSize = with(androidx.compose.ui.platform.LocalDensity.current) { (side * .72f).toSp() })
            }
        }
    }
}

/**
 * The live-call Dot: a steady spinner circles the small figure while connecting; on connect the
 * arc closes and the Dot pops out to full size. Listening grows with your voice, speaking bounces
 * with Lumen's, working shows the lamp and friends.
 */
@Composable
internal fun DotCallFigure(
    avatar: DotAvatar,
    mood: DotMood,
    connecting: Boolean,
    userLevel: Float,
    agentLevel: Float,
    modifier: Modifier = Modifier,
) {
    val reducedMotion = !ValueAnimator.areAnimatorsEnabled()
    val reveal by animateFloatAsState(if (connecting) 0f else 1f,
        tween(if (reducedMotion) 0 else if (connecting) 450 else 900, easing = androidx.compose.animation.core.LinearEasing), label = "dot reveal")
    val spin = remember { mutableFloatStateOf(0f) }
    val spinning = connecting || reveal < .999f
    LaunchedEffect(spinning, reducedMotion) {
        if (!spinning || reducedMotion) return@LaunchedEffect
        var last = 0L
        while (true) withFrameNanos { now -> if (last != 0L) spin.floatValue = (spin.floatValue + (now - last) / 1_000_000_000f) % 1_000f; last = now }
    }
    Box(modifier, contentAlignment = androidx.compose.ui.Alignment.Center) {
        val grow = run {
            val x = ((reveal - .15f) / .85f).coerceIn(0f, 1f); val k = 1.4f; val v = x - 1f
            1f + (k + 1f) * v * v * v + k * v * v
        }
        DotFigure(avatar, if (connecting) DotMood.IDLE else mood,
            Modifier.fillMaxSize(.78f).graphicsLayer { val sc = .55f + .45f * grow; scaleX = sc; scaleY = sc },
            userLevel = userLevel, agentLevel = agentLevel)
        val ring = 1f - ((reveal - .5f) / .5f).coerceIn(0f, 1f)
        if (ring > .01f) Canvas(Modifier.fillMaxSize()) {
            val stroke = 2.5.dp.toPx()
            val rr = size.minDimension / 2f - stroke
            val topLeft = Offset(center.x - rr, center.y - rr)
            val arc = Size(rr * 2, rr * 2)
            val close = (reveal / .4f).coerceIn(0f, 1f)
            drawCircle(Color.White.copy(alpha = ring * .1f), radius = rr, center = center, style = androidx.compose.ui.graphics.drawscope.Stroke(stroke))
            val sweep = 100f + 260f * close
            val start = if (reducedMotion) -90f else (spin.floatValue * 330f) % 360f
            drawArc(avatar.glow.copy(alpha = ring * .4f), start, sweep, false, topLeft, arc,
                style = androidx.compose.ui.graphics.drawscope.Stroke(stroke * 2.6f, cap = androidx.compose.ui.graphics.StrokeCap.Round))
            drawArc(Color.White.copy(alpha = ring), start, sweep, false, topLeft, arc,
                style = androidx.compose.ui.graphics.drawscope.Stroke(stroke, cap = androidx.compose.ui.graphics.StrokeCap.Round))
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
