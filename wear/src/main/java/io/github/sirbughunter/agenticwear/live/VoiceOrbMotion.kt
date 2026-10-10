package io.github.sirbughunter.agenticwear.live

import kotlin.math.sqrt
import kotlin.math.sin

internal enum class VoiceOrbMode { STILL, LISTENING, SPEAKING }

internal data class VoiceOrbMotion(
    val mode: VoiceOrbMode = VoiceOrbMode.STILL,
    val scale: Float = 1f,
    val fogStrength: Float = 0f,
    val flowSpeed: Float = 0f,
    val frameIntervalMillis: Long = 0,
)

private fun mediaEnergy(level: Float): Float = if (level.isFinite()) level.coerceIn(0f, 1f) else 0f

/** Energy is observed audio, never inferred emotion. Speaking changes fog, not radius. */
internal fun voiceOrbMotion(
    input: Float, output: Float, speaking: Boolean, muted: Boolean,
    available: Boolean = true, reducedMotion: Boolean = false, visible: Boolean = true,
): VoiceOrbMotion {
    if (!available || reducedMotion || !visible) return VoiceOrbMotion()
    val incoming = mediaEnergy(output)
    val outgoing = if (muted) 0f else mediaEnergy(input)
    if (speaking || incoming > .01f) {
        val strength = sqrt(incoming)
        return VoiceOrbMotion(VoiceOrbMode.SPEAKING, scale = 1f,
            fogStrength = .32f + .68f * strength,
            flowSpeed = .60f + 2.0f * strength, frameIntervalMillis = 50)
    }
    if (outgoing > .01f) {
        val strength = sqrt(outgoing)
        return VoiceOrbMotion(VoiceOrbMode.LISTENING, scale = 1f + .12f * strength,
            fogStrength = .18f + .38f * strength,
            flowSpeed = .28f + .95f * strength, frameIntervalMillis = 100)
    }
    return VoiceOrbMotion()
}

/** A rolling cloud front can fill the disk, then uncover its colour again.
 * Phase advances only with observed media; coverage is geometry, not opacity.
 */
internal fun voiceFogCoverage(strength: Float, phase: Float): Float {
    val flow = if (phase.isFinite()) phase else 0f
    val sweep = .5f + .5f * (.62f * sin(flow * .71f - .35f) + .38f * sin(flow * 1.13f + .90f))
    return mediaEnergy(strength) * (.25f + .75f * sweep)
}

/** RMS fallback for audio stats that expose energy/duration but omit audioLevel. */
internal class VoiceAudioEnergy {
    private var previousEnergy: Double? = null
    private var previousDuration: Double? = null

    fun sample(level: Double?, energy: Double?, duration: Double?): Float {
        val validTotals = energy != null && energy.isFinite() && energy >= 0 &&
            duration != null && duration.isFinite() && duration >= 0
        val oldEnergy = previousEnergy
        val oldDuration = previousDuration
        previousEnergy = energy.takeIf { validTotals }
        previousDuration = duration.takeIf { validTotals }
        if (level != null && level.isFinite() && level >= 0) return level.coerceAtMost(1.0).toFloat()
        if (!validTotals || oldEnergy == null || oldDuration == null) return 0f
        val deltaEnergy = energy - oldEnergy
        val deltaDuration = duration - oldDuration
        if (deltaEnergy < 0 || deltaDuration <= 0) return 0f
        return sqrt(deltaEnergy / deltaDuration).takeIf { it.isFinite() }?.coerceIn(0.0, 1.0)?.toFloat() ?: 0f
    }
}
