package io.github.sirbughunter.agenticwear.ui

import android.animation.ValueAnimator
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.LinearEasing
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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
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

    val loading = mode == OrbMode.Connecting || mode == OrbMode.Reconnecting

    val scale by animateFloatAsState(
        targetValue = if (loading) 1f else 1f + 0.16f * sqrt(user),
        animationSpec = spring(dampingRatio = .42f, stiffness = 420f, visibilityThreshold = .001f),
        label = "orb size from user speech",
    )
    // One motion: 0 = a small core searching inside the spinner; 1 = live. On the way up the arc
    // closes into a full ring, the orb blooms out into it, and the ring melts into the orb's rim.
    val reveal by animateFloatAsState(
        targetValue = if (loading) 0f else 1f,
        animationSpec = tween(if (reducedMotion) 0 else if (loading) 450 else 1000, easing = LinearEasing),
        label = "spinner to orb",
    )
    val energy by animateFloatAsState(
        targetValue = when {
            frozen -> 0f
            mode == OrbMode.Speaking -> 0.45f + 0.55f * (agent * 1.6f).coerceAtMost(1f)
            mode == OrbMode.Thinking -> 0.38f
            mode == OrbMode.Listening -> 0.16f
            mode == OrbMode.Connecting -> 0.6f
            else -> 0.07f
        },
        animationSpec = spring(dampingRatio = 1f, stiffness = 120f),
        label = "fog energy from agent speech",
    )
    val halo by animateFloatAsState(
        targetValue = when {
            frozen || loading -> 0f
            mode == OrbMode.Speaking -> .4f
            else -> .14f + .5f * sqrt(user)
        },
        animationSpec = tween(260),
        label = "halo",
    )
    val desaturate by animateFloatAsState(if (mode == OrbMode.Approval || mode == OrbMode.Muted || mode == OrbMode.Reconnecting || mode == OrbMode.Disabled) 1f else 0f, tween(400), label = "freeze")

    // Fog phase advances on the frame clock only while it is visibly moving; the loading clock
    // (seconds) drives the spinner, the core's breathing and the reveal.
    val phase = remember { mutableFloatStateOf(0f) }
    val clock = remember { mutableFloatStateOf(0f) }
    val energyState by rememberUpdatedState(energy)
    val revealing = reveal < .999f
    val ticking = loading || revealing || mode == OrbMode.Thinking
    // Idle drift is slow enough that ~20 fps looks identical and saves battery;
    // live and working states run on every frame.
    val lowPower = mode == OrbMode.Idle && !revealing
    LaunchedEffect(reducedMotion, frozen, ticking, lowPower) {
        if (reducedMotion || (frozen && !ticking)) return@LaunchedEffect
        var last = 0L
        fun advance(now: Long) {
            if (last != 0L) {
                val dt = ((now - last) / 1_000_000_000f).coerceAtMost(0.08f)
                if (!frozen) phase.floatValue += dt * (0.045f + energyState * 0.62f)
                if (ticking) clock.floatValue = (clock.floatValue + dt) % 1_000f
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
                    val breath = if (!reducedMotion && mode == OrbMode.Thinking) 1f + .03f * sin(2f * PI.toFloat() * clock.floatValue / 2.4f) else 1f
                    scaleX = scale * breath
                    scaleY = scale * breath
                    alpha = if (mode == OrbMode.Reconnecting) .8f else 1f
                },
        ) {
            val r = size.minDimension / 2f
            val c = center
            val t = clock.floatValue
            val pulse = if (reducedMotion) 0f else sin(2f * PI.toFloat() * t / 1.6f)
            val close = smoothStep(reveal / .4f)
            val grow = backOut(((reveal - .18f) / .82f).coerceIn(0f, 1f))
            val ringVisible = 1f - smoothStep((reveal - .55f) / .45f)
            val core = mix(.42f + .03f * pulse, 1f, grow)
            val stroke = 2.5.dp.toPx()
            val ringRadius = r - stroke
            if (ringVisible > 0.01f) {
                drawCircle(
                    Brush.radialGradient(listOf(base.copy(alpha = ringVisible * (.2f + .1f * pulse)), Color.Transparent), center = c, radius = r),
                    radius = r, center = c,
                )
            }
            scale(core, pivot = c) {
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
                    val f = phase.floatValue
                    val travel = 1f + energy * 0.9f
                    rotate(degrees = f * 43f, pivot = c) {
                        fog(c, r, f, 0.9f, 0.0f, -.36f, -.48f, .22f * travel, .78f, Color.White.copy(alpha = .92f))
                        fog(c, r, f, 0.7f, 1.7f, .34f, .36f, .28f * travel, .92f, deep.copy(alpha = .95f))
                        fog(c, r, f, 1.15f, 3.1f, .26f, -.34f, .30f * travel, .62f, accent.copy(alpha = .9f))
                        fog(c, r, f, 0.8f, 4.4f, -.36f, .4f, .24f * travel, .7f, base)
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
            }
            if (ringVisible > 0.01f) {
                // Searching: a fixed arc spinning at a steady speed; on connect it closes into the rim.
                val topLeft = Offset(c.x - ringRadius, c.y - ringRadius)
                val arcSize = Size(ringRadius * 2, ringRadius * 2)
                drawCircle(light.copy(alpha = ringVisible * .1f), radius = ringRadius, center = c, style = Stroke(stroke))
                val sweep = mix(100f, 360f, close)
                val start = if (reducedMotion) -90f else (t * 330f) % 360f
                drawArc(base.copy(alpha = ringVisible * .35f), start, sweep, false, topLeft, arcSize, style = Stroke(stroke * 2.6f, cap = StrokeCap.Round))
                drawArc(light.copy(alpha = ringVisible), start, sweep, false, topLeft, arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
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

private fun mix(a: Float, b: Float, f: Float): Float = a + (b - a) * f

private fun smoothStep(x: Float): Float { val v = x.coerceIn(0f, 1f); return v * v * (3f - 2f * v) }

/** Ease-out with a gentle overshoot, so the orb blooms slightly past the ring and settles. */
private fun backOut(x: Float): Float { val k = 1.25f; val v = x - 1f; return 1f + (k + 1f) * v * v * v + k * v * v }
