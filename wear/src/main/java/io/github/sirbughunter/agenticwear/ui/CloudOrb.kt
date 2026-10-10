package io.github.sirbughunter.agenticwear.ui

import android.animation.ValueAnimator
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MicOff
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.Icon
import io.github.sirbughunter.agenticwear.live.LiveVoiceColour
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** Four-colour palette for the cloud orb, derived from the user's orb colour. */
internal data class OrbPalette(val deep: Color, val base: Color, val light: Color, val accent: Color)

internal fun LiveVoiceColour.orbPalette(): OrbPalette {
    if (this == LiveVoiceColour.MONO) {
        return OrbPalette(Color(0xFF3F3F46), Color(0xFFA1A1AA), Color(0xFFFAFAFA), Color(0xFFE4E4E7))
    }
    val hsv = FloatArray(3)
    android.graphics.Color.colorToHSV(rgb or (0xFF shl 24), hsv)
    fun hsv(h: Float, s: Float, v: Float) = Color(android.graphics.Color.HSVToColor(floatArrayOf(((h % 360f) + 360f) % 360f, s.coerceIn(0f, 1f), v.coerceIn(0f, 1f))))
    return OrbPalette(
        deep = hsv(hsv[0], hsv[1] * 1.08f, hsv[2] * 0.62f),
        base = Color(rgb or (0xFF shl 24)),
        light = hsv(hsv[0], hsv[1] * 0.12f, 1f),
        accent = hsv(hsv[0] + 28f, hsv[1] * 0.55f, 1f),
    )
}

internal enum class OrbMode { Idle, Connecting, Listening, Speaking, Thinking, Approval, Muted, Reconnecting, Disabled }

/**
 * The live-voice cloud orb.
 *
 * Size follows only the user's own observed input level. The agent's observed
 * output level never changes the size; it makes the fog inside move faster and
 * travel further. Approval waits, muted input and reduced motion freeze it.
 */
@Composable
internal fun CloudOrb(
    palette: OrbPalette,
    mode: OrbMode,
    userLevel: Float,
    agentLevel: Float,
    modifier: Modifier = Modifier,
    description: String? = null,
) {
    val reducedMotion = !ValueAnimator.areAnimatorsEnabled()
    val frozen = reducedMotion || mode == OrbMode.Approval || mode == OrbMode.Muted || mode == OrbMode.Reconnecting || mode == OrbMode.Disabled
    val user = if (frozen || mode == OrbMode.Speaking) 0f else userLevel.takeIf { it.isFinite() }?.coerceIn(0f, 1f) ?: 0f
    val agent = if (frozen) 0f else agentLevel.takeIf { it.isFinite() }?.coerceIn(0f, 1f) ?: 0f

    val scale by animateFloatAsState(
        targetValue = when (mode) {
            OrbMode.Connecting, OrbMode.Reconnecting -> 0.84f
            else -> 1f + 0.16f * sqrt(user)
        },
        animationSpec = spring(dampingRatio = .42f, stiffness = 420f, visibilityThreshold = .001f),
        label = "orb size from user speech",
    )
    val energy by animateFloatAsState(
        targetValue = when {
            frozen -> 0f
            mode == OrbMode.Speaking -> 0.45f + 0.55f * (agent * 1.6f).coerceAtMost(1f)
            mode == OrbMode.Thinking -> 0.38f
            mode == OrbMode.Listening -> 0.16f
            mode == OrbMode.Connecting -> 0.22f
            else -> 0.07f
        },
        animationSpec = spring(dampingRatio = 1f, stiffness = 120f),
        label = "fog energy from agent speech",
    )
    val halo by animateFloatAsState(
        targetValue = when {
            frozen || mode == OrbMode.Connecting -> 0f
            mode == OrbMode.Speaking -> .4f
            else -> .14f + .5f * sqrt(user)
        },
        animationSpec = tween(260),
        label = "halo",
    )
    val desaturate by animateFloatAsState(if (mode == OrbMode.Approval || mode == OrbMode.Muted || mode == OrbMode.Reconnecting || mode == OrbMode.Disabled) 1f else 0f, tween(400), label = "freeze")
    val ringAlpha by animateFloatAsState(if (mode == OrbMode.Connecting || mode == OrbMode.Reconnecting) 1f else 0f, tween(300), label = "ring")

    // Fog phase advances on the frame clock only while it is visibly moving.
    val phase = remember { mutableFloatStateOf(0f) }
    val ringPhase = remember { mutableFloatStateOf(0f) }
    val energyState by rememberUpdatedState(energy)
    val ringActive = mode == OrbMode.Connecting || mode == OrbMode.Reconnecting
    // Idle drift is slow enough that ~20 fps looks identical and saves battery;
    // live and working states run on every frame.
    val lowPower = mode == OrbMode.Idle
    LaunchedEffect(reducedMotion, frozen, ringActive, lowPower) {
        if (reducedMotion || (frozen && !ringActive)) return@LaunchedEffect
        var last = 0L
        fun advance(now: Long) {
            if (last != 0L) {
                val dt = ((now - last) / 1_000_000_000f).coerceAtMost(0.08f)
                if (!frozen) phase.floatValue += dt * (0.045f + energyState * 0.62f)
                if (ringActive) ringPhase.floatValue = (ringPhase.floatValue + dt * 0.9f) % 1f
            }
            last = now
        }
        while (true) {
            if (lowPower) {
                delay(50)
                advance(System.nanoTime())
            } else {
                withFrameNanos(::advance)
            }
        }
    }

    val grey = Color(0xFF8E8E93)
    val deep = lerp(palette.deep, Color(0xFF2A2A2E), desaturate * .8f)
    val base = lerp(palette.base, grey, desaturate * .8f)
    val light = lerp(palette.light, Color(0xFFDADADA), desaturate * .6f)
    val accent = lerp(palette.accent, Color(0xFFBDBDBD), desaturate * .8f)

    Box(
        modifier.semantics { if (description != null) contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    alpha = if (mode == OrbMode.Connecting || mode == OrbMode.Reconnecting) .7f else 1f
                },
        ) {
            val r = size.minDimension / 2f
            val c = center
            if (halo > 0.01f) {
                drawCircle(
                    Brush.radialGradient(listOf(base.copy(alpha = halo), Color.Transparent), center = c, radius = r * 1.5f),
                    radius = r * 1.5f,
                    center = c,
                )
            }
            val circle = Path().apply { addOval(androidx.compose.ui.geometry.Rect(c, r)) }
            clipPath(circle) {
                drawCircle(
                    Brush.radialGradient(
                        0f to deep, .46f to base, 1f to light,
                        center = Offset(c.x, c.y + r * 1.18f),
                        radius = r * 2.25f,
                    ),
                    radius = r, center = c,
                )
                val t = phase.floatValue
                val travel = 1f + energy * 0.9f
                rotate(degrees = t * 43f, pivot = c) {
                    fog(c, r, t, 0.9f, 0.0f, -.36f, -.48f, .22f * travel, .78f, Color.White.copy(alpha = .92f))
                    fog(c, r, t, 0.7f, 1.7f, .34f, .36f, .28f * travel, .92f, deep.copy(alpha = .95f))
                    fog(c, r, t, 1.15f, 3.1f, .26f, -.34f, .30f * travel, .62f, accent.copy(alpha = .9f))
                    fog(c, r, t, 0.8f, 4.4f, -.36f, .4f, .24f * travel, .7f, base)
                }
                drawCircle(
                    Brush.radialGradient(listOf(Color.White.copy(alpha = .5f), Color.Transparent),
                        center = Offset(c.x - r * .36f, c.y - r * .52f), radius = r * .72f),
                    radius = r, center = c,
                )
                drawCircle(
                    Brush.radialGradient(0f to Color.Transparent, .6f to Color.Transparent, 1f to Color.Black.copy(alpha = .16f), center = c, radius = r),
                    radius = r, center = c,
                )
            }
            if (ringAlpha > 0.01f) {
                val stroke = 2.dp.toPx()
                val ringRadius = r + 6.dp.toPx()
                rotate(degrees = ringPhase.floatValue * 360f, pivot = c) {
                    drawCircle(
                        Brush.sweepGradient(0f to Color.Transparent, .55f to Color.Transparent, .92f to light.copy(alpha = ringAlpha), 1f to Color.Transparent, center = c),
                        radius = ringRadius, center = c, style = Stroke(stroke, cap = StrokeCap.Round),
                    )
                }
            }
        }
        if (mode == OrbMode.Muted) {
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .size(26.dp)
                    .clip(CircleShape)
                    .background(Aw.SurfaceHigh)
                    .border(2.dp, Color.Black, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Rounded.MicOff, contentDescription = null, tint = Aw.Text, modifier = Modifier.size(14.dp))
            }
        }
    }
}

/** One soft fog blob orbiting inside the orb; amplitude grows with agent speech. */
private fun DrawScope.fog(
    c: Offset, r: Float, t: Float, speed: Float, seed: Float,
    bx: Float, by: Float, amplitude: Float, radius: Float, color: Color,
) {
    val a = 2f * PI.toFloat() * t * speed + seed
    val center = Offset(
        c.x + r * (bx + amplitude * sin(a)),
        c.y + r * (by + amplitude * cos(a * 0.83f + seed)),
    )
    drawCircle(
        Brush.radialGradient(listOf(color, color.copy(alpha = 0f)), center = center, radius = r * radius),
        radius = r * radius, center = center,
    )
}
