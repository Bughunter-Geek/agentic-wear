package io.github.sirbughunter.agenticwear.live

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.wear.compose.material3.Text
import android.animation.ValueAnimator

/** Only observed media and native work drive the visual; no simulated waveform. */
internal fun LiveVoiceState.taskToOpen(selected: String?): String? = taskId.takeIf { it.isNotBlank() } ?: selected

internal fun LiveVoiceState.hasCurrentApproval(): Boolean = phase == "live" && taskPhase == "approval" &&
    !approvalId.isNullOrBlank() && canApprove

internal fun LiveVoiceState.decisionRequestId(): String? = approvalId.takeIf { hasCurrentApproval() && !deciding }

internal fun LiveVoiceState.withConnection(connected: Boolean): LiveVoiceState = copy(
    phase = if (connected) "live" else "reconnecting",
    detail = if (connected) "Speak naturally · Codex live voice" else "Connection interrupted…",
    canApprove = connected && canApprove, deciding = connected && deciding)

internal fun LiveVoiceState.observedMediaLevel(): Float = if (phase != "live" || approvalId != null) 0f else
    maxOf(outputLevel.takeIf { it.isFinite() } ?: 0f, if (muted) 0f else inputLevel.takeIf { it.isFinite() } ?: 0f)
        .coerceIn(0f, 1f).takeIf { it > .01f } ?: 0f

internal fun LiveVoiceState.orbScaleTarget(reducedMotion: Boolean): Float = if (reducedMotion) 1f else
    1f + .48f * kotlin.math.sqrt(observedMediaLevel())

internal fun LiveVoiceState.activityLabel(): String = when {
    phase != "live" -> detail
    approvalId != null -> "Permission needed"
    outputLevel > 0.01f || mediaActivity == "speaking" -> "Speaking"
    !muted && (inputLevel > 0.01f || mediaActivity == "listening") -> "Listening"
    taskPhase in setOf("handoff", "working") -> taskDetail.ifBlank { "Codex is working" }
    mediaActivity == "thinking" -> "Waiting for a reply"
    muted -> "Microphone muted"
    else -> "Ready to listen"
}

@Composable
internal fun LiveVoiceOrb(state: LiveVoiceState, colour: LiveVoiceColour = LiveVoiceColour.TEAL, diameter: Dp = 80.dp) {
    val reducedMotion = !ValueAnimator.areAnimatorsEnabled()
    val scale by animateFloatAsState(state.orbScaleTarget(reducedMotion),
        animationSpec = spring(dampingRatio = .38f, stiffness = 520f, visibilityThreshold = .001f),
        label = "Observed voice spring")
    val frozen = state.approvalId != null || state.phase != "live" || reducedMotion
    val blocked = state.approvalId != null || state.phase == "reconnecting"
    val appearance = if (state.muted || state.phase != "live") LiveVoiceColour.MONO else colour
    val texture = remember(appearance) { cloudOrbTexture(appearance) }
    Box(Modifier.size(diameter).semantics { contentDescription = state.activityLabel() }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(diameter)) {
            val radius = size.minDimension * .3f * (if (frozen) 1f else scale.coerceIn(.94f, 1.55f))
            if (blocked) {
                drawCircle(Color(0xFF171922), radius)
                drawCircle(Color(0xFFFFBE70), radius, style = Stroke(width = 1.5.dp.toPx()))
            } else {
                val pixels = (radius * 2).toInt()
                drawImage(texture, dstOffset = IntOffset((center.x - radius).toInt(), (center.y - radius).toInt()),
                    dstSize = IntSize(pixels, pixels))
            }
        }
        if (blocked) Text("?", color = Color(0xFFFFE5BD),
            fontSize = if (diameter < 40.dp) 15.sp else 24.sp, fontWeight = FontWeight.Bold)
        else if (state.muted) Text("Ⅱ", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
    }
}
