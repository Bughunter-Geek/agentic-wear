package io.github.sirbughunter.agenticwear.voice

import kotlin.math.sqrt

private const val RECORDER_NOISE_GATE = 1_000f
private const val RECORDER_MAX_AMPLITUDE = 32_767f

internal fun voiceActivityLevel(amplitude: Int): Float {
    val normalized = ((amplitude.coerceAtLeast(0) - RECORDER_NOISE_GATE) /
        (RECORDER_MAX_AMPLITUDE - RECORDER_NOISE_GATE)).coerceIn(0f, 1f)
    return sqrt(normalized)
}

internal fun rmsVoiceActivityLevel(rmsDb: Float): Float {
    val normalized = ((rmsDb - 0.5f) / 9.5f).coerceIn(0f, 1f)
    return sqrt(normalized)
}
