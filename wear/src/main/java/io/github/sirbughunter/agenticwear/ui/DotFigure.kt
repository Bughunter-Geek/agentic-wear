package io.github.sirbughunter.agenticwear.ui

import android.animation.ValueAnimator
import androidx.annotation.DrawableRes
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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
/** [sleepRes] is the same figure with closed eyes, where one exists. */
internal enum class DotAvatar(val label: String, @param:DrawableRes val res: Int, val glow: Color, @param:DrawableRes val sleepRes: Int? = null) {
    EMBER("Ember", R.drawable.dot_ember, Color(0xFFE8643C)),
    FELIPE("Felipe", R.drawable.dot_felipe, Color(0xFF3BA0E8), R.drawable.dot_felipe_sleep),
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
    eyesClosed: Boolean = mood == DotMood.SLEEPING,
) {
    val reducedMotion = !ValueAnimator.areAnimatorsEnabled()
    // Eyes close slowly and open a little quicker, like waking up.
    val closed by animateFloatAsState(if (eyesClosed) 1f else 0f,
        tween(if (reducedMotion) 0 else if (eyesClosed) 600 else 320, easing = FastOutSlowInEasing), label = "eyes")
    val clock = remember { mutableFloatStateOf(0f) }
    // Every mood weight eases slowly in and out; the loops below are sums of weighted components.
    val soft = tween<Float>(800, easing = FastOutSlowInEasing)
    val think by animateFloatAsState(if (mood == DotMood.THINKING) 1f else 0f, soft, label = "think")
    val speakingMood = mood == DotMood.RESPONDING || mood == DotMood.SPEAKING
    val speakWeight by animateFloatAsState(if (speakingMood) 1f else 0f, soft, label = "speak weight")
    val speakLevel by animateFloatAsState(
        when (mood) {
            DotMood.RESPONDING -> 1f
            DotMood.SPEAKING -> kotlin.math.sqrt(agentLevel.takeIf { it.isFinite() }?.coerceIn(0f, 1f) ?: 0f)
            else -> 0f
        },
        spring(dampingRatio = .9f, stiffness = 140f), label = "speak level")
    val listenWeight by animateFloatAsState(if (mood == DotMood.LISTENING) 1f else 0f, soft, label = "listen weight")
    val listenLevel by animateFloatAsState(
        if (mood == DotMood.LISTENING) kotlin.math.sqrt(userLevel.takeIf { it.isFinite() }?.coerceIn(0f, 1f) ?: 0f) else 0f,
        spring(dampingRatio = .9f, stiffness = 140f), label = "listen level")
    val needs by animateFloatAsState(if (mood == DotMood.NEEDS) 1f else 0f, soft, label = "needs")
    val frozen by animateFloatAsState(if (mood == DotMood.FROZEN) 1f else 0f, soft, label = "frozen")
    val sleep by animateFloatAsState(if (mood == DotMood.SLEEPING) 1f else 0f, soft, label = "sleep")
    val celebrate by animateFloatAsState(if (mood == DotMood.CELEBRATING) 1f else 0f, soft, label = "celebrate")
    val greet by animateFloatAsState(if (mood == DotMood.GREETING) 1f else 0f, soft, label = "greet")
    val calm by animateFloatAsState(if (mood == DotMood.IDLE || mood == DotMood.LISTENING) 1f else 0f, soft, label = "calm")
    // One-shot confetti, replayed each time the mood becomes CELEBRATING.
    val burst = remember { androidx.compose.animation.core.Animatable(1f) }
    LaunchedEffect(mood, reducedMotion) {
        if (mood != DotMood.CELEBRATING || reducedMotion) return@LaunchedEffect
        burst.snapTo(0f)
        burst.animateTo(1f, tween(1100, easing = androidx.compose.animation.core.LinearEasing))
    }
    LaunchedEffect(reducedMotion, mood) {
        if (reducedMotion) return@LaunchedEffect
        var last = 0L
        fun advance(now: Long) {
            if (last != 0L) clock.floatValue = (clock.floatValue + ((now - last) / 1_000_000_000f).coerceAtMost(.08f)) % 1_000f
            last = now
        }
        while (true) {
            // Idle breathing is slow; ~25 fps looks the same and saves battery.
            if (mood == DotMood.IDLE || mood == DotMood.SLEEPING || mood == DotMood.FROZEN) { delay(40); advance(System.nanoTime()) } else withFrameNanos(::advance)
        }
    }
    val desat = maxOf(.8f * frozen, .4f * sleep)
    val saturation = remember(desat) { ColorMatrix().apply { setToSaturation(1f - desat) } }

    Box(modifier) {
        // Glow and ground shadow.
        Canvas(Modifier.fillMaxSize()) {
            val t = clock.floatValue
            val w = size.minDimension
            val respond = speakWeight * (.35f + .65f * speakLevel)
            val glow = (1f - frozen) * (.16f - .08f * sleep + think * (.14f + .1f * sin(TAU * t / 2.6f)) + respond * .3f + needs * .22f + celebrate * .26f)
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
        Box(
            Modifier.fillMaxSize().graphicsLayer {
                val t = clock.floatValue
                val respond = speakWeight * (.35f + .65f * speakLevel)
                val listen = listenWeight * listenLevel
                transformOrigin = TransformOrigin(.5f, .9f)
                val breathe = (1f - sleep) * (1f - .6f * frozen) * .022f * sin(TAU * t / 5.5f) + think * .018f * sin(TAU * t / 3.4f) +
                    sleep * .034f * sin(TAU * t / 6f)
                val squash = respond * .03f * kotlin.math.cos(TAU * t / 1.3f)
                // A soft blink-like squish every 5-8 s while calm.
                val sq = calm * squish(t)
                scaleX = 1f + breathe + squash + .12f * listen + .02f * sq
                scaleY = 1f + breathe - squash + .12f * listen - .05f * sq
                rotationZ = think * 4f * sin(TAU * t / 4f) + sleep * 4f + greet * greetWave(t)
                translationY = (-lift(t, think, respond, needs, celebrate, greet, sleep) + sleep * .03f) * size.height
                alpha = 1f - .3f * frozen
            },
        ) {
            val filter = if (desat > .01f) ColorFilter.colorMatrix(saturation) else null
            Image(painterResource(avatar.res), contentDescription = null, colorFilter = filter, modifier = Modifier.fillMaxSize())
            val sleepRes = avatar.sleepRes
            if (sleepRes != null && closed > .01f) Image(painterResource(sleepRes), contentDescription = null, colorFilter = filter,
                alpha = closed, modifier = Modifier.fillMaxSize())
        }
        Canvas(Modifier.fillMaxSize()) { if (burst.value < .999f) drawConfetti(burst.value, avatar.glow) }
        // Only recomposes when the chosen expression changes, not every frame.
        val autoExpression by remember(mood) { androidx.compose.runtime.derivedStateOf { defaultDotExpression(mood, clock.floatValue) } }
        val shown = if (mood == DotMood.FROZEN) null else expression ?: autoExpression
        LaunchedEffect(shown) { onExpression(shown) }
        androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
            if (maxWidth >= 36.dp) DotExpression(shown, clock, maxWidth)
            if (shown == null && think > .01f && maxWidth >= 20.dp) Canvas(Modifier.fillMaxSize()) {
                // Small figures: a thought bubble of three dots that bounce in turn.
                val t = clock.floatValue
                val w = size.minDimension
                val r = (w * .055f).coerceAtLeast(1.6f)
                for (i in 0..2) {
                    val hop = abs(sin(TAU * (t / 1.8f) / 2f - i * .45f))
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
private fun DotExpression(emoji: String?, clock: androidx.compose.runtime.MutableFloatState, width: androidx.compose.ui.unit.Dp) {
    run {
        val maxWidth = width
        val side = maxWidth * .34f
        androidx.compose.animation.AnimatedContent(
            targetState = emoji,
            transitionSpec = {
                (androidx.compose.animation.scaleIn(tween(500, easing = FastOutSlowInEasing), initialScale = .6f) +
                    androidx.compose.animation.fadeIn(tween(500))) togetherWith
                    (androidx.compose.animation.scaleOut(tween(400), targetScale = .8f) + androidx.compose.animation.fadeOut(tween(400)))
            },
            label = "dot expression",
            modifier = Modifier.offset(x = maxWidth * .78f, y = -maxWidth * .02f).size(side),
        ) { shown ->
            if (shown == null) return@AnimatedContent
            val glow = expressionGlow(shown)
            Box(Modifier.fillMaxSize().graphicsLayer {
                val t = clock.floatValue
                if (shown == "💤") {
                    // Zzz: rises about a quarter of its size over 2.4 s, fading in and out, on loop.
                    val u = (t % 2.4f) / 2.4f
                    translationY = -size.height * .25f * u
                    alpha = minOf(1f, u * 5f) * (1f - u)
                } else {
                    translationY = -size.height * (.1f + .07f * sin(TAU * t / 2.6f))
                    rotationZ = 6f * sin(TAU * t / 3.4f)
                }
            }, contentAlignment = androidx.compose.ui.Alignment.Center) {
                Canvas(Modifier.fillMaxSize()) {
                    val pulse = .5f + .5f * sin(TAU * clock.floatValue / 2.6f)
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
 * The live-call Dot. While the call rings it naps with closed eyes beside a little ringing phone;
 * when the call connects the phone fades, it opens its eyes and gives a happy wiggle.
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
    val ringing = connecting && mood != DotMood.FROZEN
    val phone by animateFloatAsState(if (ringing) 1f else 0f,
        tween(if (reducedMotion) 0 else if (ringing) 500 else 450, easing = FastOutSlowInEasing), label = "phone")
    var waking by remember { mutableStateOf(false) }
    val wasRinging = remember { booleanArrayOf(ringing) }
    LaunchedEffect(ringing) {
        if (wasRinging[0] && !ringing && !connecting) { waking = true; kotlinx.coroutines.delay(1600); waking = false }
        wasRinging[0] = ringing
    }
    val clock = remember { mutableFloatStateOf(0f) }
    val visible by remember { androidx.compose.runtime.derivedStateOf { phone > .001f } }
    LaunchedEffect(visible, reducedMotion) {
        if (!visible || reducedMotion) return@LaunchedEffect
        var last = 0L
        while (true) withFrameNanos { now -> if (last != 0L) clock.floatValue = (clock.floatValue + (now - last) / 1_000_000_000f) % 1_000f; last = now }
    }
    val shownMood = when {
        ringing -> DotMood.SLEEPING
        waking -> DotMood.GREETING
        else -> mood
    }
    Box(modifier) {
        DotFigure(avatar, shownMood, Modifier.fillMaxSize(), userLevel = userLevel, agentLevel = agentLevel,
            expression = if (ringing) "💤" else null, eyesClosed = ringing)
        if (phone > .001f) androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
            val side = maxWidth * .3f
            Box(
                Modifier.offset(x = maxWidth * .74f, y = maxWidth * .74f).size(side).graphicsLayer {
                    // Rings in bursts: a quick rattle, then a pause, like a little desk phone.
                    val t = clock.floatValue
                    val inBurst = (t % 1.6f) < .7f
                    rotationZ = if (inBurst && !reducedMotion) 13f * sin(TAU * t * 9f) else 0f
                    translationY = if (inBurst && !reducedMotion) -size.height * .06f * abs(sin(TAU * t * 4.5f)) else 0f
                    alpha = phone
                    scaleX = .7f + .3f * phone; scaleY = .7f + .3f * phone
                },
                contentAlignment = androidx.compose.ui.Alignment.Center,
            ) {
                androidx.wear.compose.material3.Text("☎️", fontSize = with(androidx.compose.ui.platform.LocalDensity.current) { (side * .8f).toSp() })
            }
        }
    }
}

/** Upward offset as a fraction of the figure's height; every component is a smooth sine, so nothing is abrupt. */
private fun lift(t: Float, think: Float, respond: Float, needs: Float, celebrate: Float = 0f, greet: Float = 0f, sleep: Float = 0f): Float {
    val float = .012f * (.5f + .5f * sin(TAU * t / 6f)) * (1f - sleep)
    val bob = respond * .045f * (.5f - .5f * kotlin.math.cos(TAU * t / 1.3f))
    val hopPhase = (t / 2.2f) % 1f
    val hop = needs * if (hopPhase < .36f) .06f * sin(PI.toFloat() * hopPhase / .36f).let { it * it } else 0f
    // Celebrating: two gentle hops in the first half of every 2 s, then rest.
    val cp = (t / 2f) % 1f
    val party = celebrate * if (cp < .5f) .06f * sin(PI.toFloat() * cp / .25f).let { it * it } else 0f
    // Greeting: two small hops while the wave plays, then a pause.
    val gp = (t / 2.4f) % 1f
    val wave = greet * if (gp < .7f) .03f * sin(PI.toFloat() * gp / .35f).let { it * it } else 0f
    return float + think * .015f + bob + hop + party + wave
}

/** Degrees of tilt for a wave: two soft left-right swings of ±6° per 2.4 s, then rest. */
private fun greetWave(t: Float): Float {
    val gp = (t / 2.4f) % 1f
    return if (gp < .7f) 6f * sin(TAU * 2f * gp / .7f) * sin(PI.toFloat() * gp / .7f) else 0f
}

/** 0..1 bump for a 220 ms ease-in-out squish, at a jittered moment every 5-8 s (6.5 s cycles). */
private fun squish(t: Float): Float {
    fun jitter(c: Int) = (sin(c * 12.9898f) * 43758.547f).let { it - kotlin.math.floor(it) }
    val cycle = (t / 6.5f).toInt()
    val u = ((t % 6.5f) - (2f + jitter(cycle) * 1.5f)) / .22f
    return if (u in 0f..1f) .5f - .5f * kotlin.math.cos(TAU * u) else 0f
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
