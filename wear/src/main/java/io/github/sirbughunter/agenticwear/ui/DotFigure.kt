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
import androidx.compose.ui.graphics.drawscope.rotate
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

internal enum class DotMood { IDLE, THINKING, RESPONDING, NEEDS, FROZEN, LISTENING, SPEAKING, SLEEPING, CELEBRATING, GREETING }

/**
 * The emoji a Dot can react with (ChatGPT's react_to_user_message set). The figure floats one
 * beside itself, bobbing and glowing like the desktop companion's lamp.
 */
internal val DOT_REACTIONS = listOf("👍", "✅", "💡", "🔍", "🚀", "🤝", "🙌", "🎉", "❤️", "🤔", "👀", "😂", "🙏", "🔥", "✨", "🫡", "🪄", "🧪", "🐛", "🫠", "🍳", "🧹")

/** An orb palette in the Dot's own colour, so an orb shown for a Dot matches it. */
internal fun DotAvatar.orbPalette(): OrbPalette {
    val hsv = FloatArray(3)
    android.graphics.Color.colorToHSV(android.graphics.Color.rgb((glow.red * 255).toInt(), (glow.green * 255).toInt(), (glow.blue * 255).toInt()), hsv)
    fun hsv(h: Float, s: Float, v: Float) = Color(android.graphics.Color.HSVToColor(floatArrayOf(((h % 360f) + 360f) % 360f, s.coerceIn(0f, 1f), v.coerceIn(0f, 1f))))
    return OrbPalette(
        deep = hsv(hsv[0], hsv[1] * 1.08f, hsv[2] * .62f),
        base = glow,
        light = hsv(hsv[0], hsv[1] * .12f, 1f),
        accent = hsv(hsv[0] + 28f, hsv[1] * .55f, 1f),
    )
}

/** The Dot mood that matches a live-call orb mode. */
internal fun OrbMode.toDotMood(): DotMood = when (this) {
    OrbMode.Listening -> DotMood.LISTENING
    OrbMode.Speaking -> DotMood.SPEAKING
    OrbMode.Thinking -> DotMood.THINKING
    OrbMode.Approval -> DotMood.NEEDS
    OrbMode.Muted, OrbMode.Reconnecting, OrbMode.Disabled -> DotMood.FROZEN
    else -> DotMood.IDLE
}

/** The expression for a mood when the Dot hasn't chosen its own; thinking cycles through ideas. */
internal fun defaultDotExpression(mood: DotMood, seconds: Float): String? = when (mood) {
    DotMood.THINKING -> "💡"
    DotMood.RESPONDING -> "✨"
    DotMood.NEEDS -> "👀"
    DotMood.SLEEPING -> "💤"
    DotMood.CELEBRATING -> "🎉"
    DotMood.GREETING -> "🙌"
    else -> null
}

/** A short human label for a reaction emoji, shown under the Dot while it reacts. */
internal fun dotReactionLabel(emoji: String): String = when (emoji) {
    "💡" -> "Got an idea"
    "🔍" -> "Looking into it"
    "🎉" -> "Celebrating"
    "👀" -> "Watching closely"
    "🫡" -> "On it"
    "🧹" -> "Cleaning up"
    "🐛" -> "Bug hunting"
    "🧪" -> "Testing"
    "🍳" -> "Cooking something up"
    "🫠" -> "Oof"
    "🪄" -> "Making magic"
    "✨" -> "Polishing"
    "🔥" -> "On fire"
    "🙏" -> "Thanks"
    "😂" -> "Ha!"
    "🤔" -> "Thinking"
    "❤️" -> "Love it"
    "🙌" -> "Yay"
    "🤝" -> "Deal"
    "🚀" -> "Shipping"
    "✅" -> "Done"
    "👍" -> "Sounds good"
    "💤" -> "Napping"
    else -> ""
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
    /** Reports the expression currently shown (or null), so callers can caption it. */
    onExpression: (String?) -> Unit = {},
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
    val sleep by animateFloatAsState(if (mood == DotMood.SLEEPING) 1f else 0f, tween(700), label = "sleep")
    val celebrate by animateFloatAsState(if (mood == DotMood.CELEBRATING) 1f else 0f, tween(240), label = "celebrate")
    val greet by animateFloatAsState(if (mood == DotMood.GREETING) 1f else 0f, tween(240), label = "greet")
    val calm by animateFloatAsState(if (mood == DotMood.IDLE || mood == DotMood.LISTENING) 1f else 0f, tween(300), label = "calm")
    // One-shot confetti, replayed each time the mood becomes CELEBRATING.
    val burst = remember { androidx.compose.animation.core.Animatable(1f) }
    LaunchedEffect(mood, reducedMotion) {
        if (mood != DotMood.CELEBRATING || reducedMotion) return@LaunchedEffect
        burst.snapTo(0f)
        burst.animateTo(1f, tween(1100, easing = androidx.compose.animation.core.LinearEasing))
    }
    LaunchedEffect(reducedMotion, mood) {
        if (reducedMotion || mood == DotMood.FROZEN) return@LaunchedEffect
        var last = 0L
        fun advance(now: Long) {
            if (last != 0L) clock.floatValue = (clock.floatValue + ((now - last) / 1_000_000_000f).coerceAtMost(.08f)) % 1_000f
            last = now
        }
        while (true) {
            // Idle breathing is slow; ~25 fps looks the same and saves battery.
            if (mood == DotMood.IDLE || mood == DotMood.SLEEPING) { delay(40); advance(System.nanoTime()) } else withFrameNanos(::advance)
        }
    }
    val desat = maxOf(.8f * frozen, .4f * sleep)
    val saturation = remember(desat) { ColorMatrix().apply { setToSaturation(1f - desat) } }

    Box(modifier) {
        // Glow and ground shadow.
        Canvas(Modifier.fillMaxSize()) {
            val t = clock.floatValue
            val w = size.minDimension
            val glow = (1f - frozen) * (.16f - .08f * sleep + think * (.14f + .1f * sin(TAU * t / 1.6f)) + respond * .3f + needs * .22f + celebrate * .26f)
            if (glow > .01f) drawCircle(
                Brush.radialGradient(listOf(avatar.glow.copy(alpha = glow), Color.Transparent), center = center, radius = w * .78f),
                radius = w * .78f, center = center,
            )
            if (w > 30f) {
                val lift = lift(t, think, respond, needs, celebrate, greet, sleep)
                val shadowW = w * .5f * (1f - lift * 2.2f)
                drawOval(
                    Brush.radialGradient(listOf(Color.Black.copy(alpha = .5f), Color.Transparent), center = Offset(center.x, w * .97f), radius = shadowW / 2),
                    topLeft = Offset(center.x - shadowW / 2, w * .93f), size = Size(shadowW, w * .08f),
                )
            }
        }
        Image(
            painterResource(avatar.res), contentDescription = null,
            colorFilter = if (desat > .01f) ColorFilter.colorMatrix(saturation) else null,
            modifier = Modifier.fillMaxSize().graphicsLayer {
                val t = clock.floatValue
                transformOrigin = TransformOrigin(.5f, .9f)
                val breathe = (1f - sleep) * .022f * sin(TAU * t / 4.2f) + think * .018f * sin(TAU * t / 2.2f) +
                    sleep * .034f * sin(TAU * t / 6f)
                val bounce = (t / .82f) % 1f
                val squash = respond * .06f * kotlin.math.cos(TAU * bounce)
                // A quick blink-like squish every 4-6 s while calm.
                val sq = calm * squish(t)
                scaleX = 1f + breathe + squash + .12f * listen + .04f * sq
                scaleY = 1f + breathe - squash + .12f * listen - .1f * sq
                rotationZ = think * 7f * sin(TAU * t / 2.6f) + sleep * 4f + greet * greetWave(t)
                translationY = (-lift(t, think, respond, needs, celebrate, greet, sleep) + sleep * .03f) * size.height
                alpha = 1f - .3f * frozen
            },
        )
        Canvas(Modifier.fillMaxSize()) { if (burst.value < .999f) drawConfetti(burst.value, avatar.glow) }
        // Only recomposes when the chosen expression changes, not every frame.
        val autoExpression by remember(mood) { androidx.compose.runtime.derivedStateOf { defaultDotExpression(mood, clock.floatValue) } }
        val shown = if (mood == DotMood.FROZEN) null else expression ?: autoExpression
        LaunchedEffect(shown) { onExpression(shown) }
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
                if (shown == "💤") {
                    // Zzz: rises about a quarter of its size over 2.4 s, fading in and out, on loop.
                    val u = (t % 2.4f) / 2.4f
                    translationY = -size.height * .25f * u
                    alpha = minOf(1f, u * 5f) * (1f - u)
                } else {
                    translationY = -size.height * (.1f + .1f * sin(TAU * t / 1.8f))
                    rotationZ = 6f * sin(TAU * t / 3.4f)
                }
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
 * The live-call Dot: a steady spinner circles a small cloud orb while connecting; on connect the
 * arc closes, the orb swells and fades, and the Dot grows out of its centre with a burst of
 * sparkles. Reconnecting reverses it. Listening grows with your voice, speaking bounces with
 * Lumen's, working shows the lamp and friends.
 */
@Composable
internal fun DotCallFigure(
    avatar: DotAvatar,
    palette: OrbPalette,
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
    // Composition only changes when a layer appears or disappears; per-frame values stay in layers.
    val orbVisible by remember { androidx.compose.runtime.derivedStateOf { reveal < .98f } }
    val dotVisible by remember { androidx.compose.runtime.derivedStateOf { reveal > .01f } }
    Box(modifier, contentAlignment = androidx.compose.ui.Alignment.Center) {
        if (orbVisible) CloudOrb(
            palette = palette, mode = OrbMode.Thinking, userLevel = 0f, agentLevel = 0f,
            modifier = Modifier.fillMaxSize(.62f).graphicsLayer {
                val k = smoothStep(reveal / .6f)
                val sc = 1f + .25f * k
                scaleX = sc; scaleY = sc
                alpha = 1f - smoothStep((reveal - .08f) / .5f)
            },
        )
        if (dotVisible) DotFigure(avatar, if (connecting) DotMood.IDLE else mood,
            Modifier.fillMaxSize(.78f).graphicsLayer {
                val x = ((reveal - .2f) / .8f).coerceIn(0f, 1f)
                val sc = .3f + .7f * backOut(x)
                scaleX = sc; scaleY = sc
                alpha = smoothStep((reveal - .15f) / .45f)
            },
            userLevel = userLevel, agentLevel = agentLevel)
        // Sparkles: eight dots fly outward from the centre as the Dot emerges, then fade.
        if (!reducedMotion) Canvas(Modifier.fillMaxSize()) {
            val s = ((reveal - .25f) / .65f)
            if (s <= 0f || s >= 1f) return@Canvas
            val out = 1f - (1f - s) * (1f - s)
            val r = size.minDimension / 2f
            for (i in 0 until 8) {
                val a = TAU * i / 8f + .3f
                val dist = r * (.3f + .62f * out)
                val color = if (i % 2 == 0) Color.White else avatar.glow
                drawCircle(
                    color.copy(alpha = (1f - s) * .9f),
                    radius = (r * .045f).coerceAtLeast(1.5f) * (1f - .5f * s),
                    center = Offset(center.x + kotlin.math.cos(a) * dist, center.y + sin(a) * dist),
                )
            }
        }
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
private fun lift(t: Float, think: Float, respond: Float, needs: Float, celebrate: Float = 0f, greet: Float = 0f, sleep: Float = 0f): Float {
    val float = .012f * (.5f + .5f * sin(TAU * t / 4.2f)) * (1f - sleep)
    val bob = respond * .07f * abs(sin(PI.toFloat() * ((t / .82f) % 1f)))
    val hopPhase = (t / 1.7f) % 1f
    val hop = needs * if (hopPhase < .36f) .1f * sin(PI.toFloat() * hopPhase / .36f) else 0f
    // Celebrating: two quick hops in the first half of every 1.6 s, then rest.
    val cp = (t / 1.6f) % 1f
    val party = celebrate * if (cp < .5f) .13f * abs(sin(PI.toFloat() * cp / .25f)) else 0f
    // Greeting: two small hops while the wave plays, then a pause.
    val gp = (t / 2f) % 1f
    val wave = greet * if (gp < .7f) .05f * abs(sin(PI.toFloat() * gp / .35f)) else 0f
    return float + think * .015f + bob + hop + party + wave
}

/** Degrees of tilt for a wave: two left-right swings of ±10° per 2 s, then rest. */
private fun greetWave(t: Float): Float {
    val gp = (t / 2f) % 1f
    return if (gp < .7f) 10f * sin(TAU * 2f * gp / .7f) else 0f
}

/** 0..1 bump for a 120 ms squish, at a jittered moment every 4-6 s (5 s cycles, start in 1-2 s). */
private fun squish(t: Float): Float {
    val cycle = (t / 5f).toInt()
    val jitter = (sin(cycle * 12.9898f) * 43758.547f).let { it - kotlin.math.floor(it) }
    val u = ((t % 5f) - (1f + jitter)) / .12f
    return if (u in 0f..1f) sin(PI.toFloat() * u) else 0f
}

private val CONFETTI_COLORS = listOf(Color.White, Color(0xFFFFC85A), Color(0xFFFF6F8E), Color(0xFF5AC8FA))

/** 14 pieces fly radially from the figure's top, pulled down by gravity, fading out as [p] reaches 1. */
private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawConfetti(p: Float, glow: Color) {
    val w = size.minDimension
    val origin = Offset(center.x, w * .22f)
    val out = 1f - (1f - p) * (1f - p)
    for (i in 0 until 14) {
        val angle = -PI.toFloat() * (.1f + .8f * i / 13f) + .12f * ((i * 7) % 5 - 2)
        val speed = w * (.5f + .35f * (((i * 0.618f) % 1f)))
        val pos = Offset(
            origin.x + kotlin.math.cos(angle) * speed * out,
            origin.y + sin(angle) * speed * out + w * .55f * p * p,
        )
        val color = (if (i % 5 == 0) glow else CONFETTI_COLORS[i % CONFETTI_COLORS.size]).copy(alpha = (1f - p) * (1f - p * .3f))
        val piece = (w * .045f).coerceAtLeast(1.5f)
        if (i % 2 == 0) drawCircle(color, radius = piece * .6f, center = pos)
        else rotate(p * 300f + i * 40f, pivot = pos) {
            drawRoundRect(color, topLeft = Offset(pos.x - piece * .5f, pos.y - piece * .25f), size = Size(piece, piece * .5f),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(piece * .2f))
        }
    }
}
