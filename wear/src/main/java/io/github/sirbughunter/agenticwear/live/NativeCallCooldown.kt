package io.github.sirbughunter.agenticwear.live

internal const val NATIVE_CALL_COOLDOWN_MS = 20_000L

/** Monotonic deadline: process recreation keeps the same clock; a reboot clears stale windows. */
internal fun nativeCallCooldownRemainingMs(endedAtMs: Long?, nowMs: Long): Long {
    if (endedAtMs == null || endedAtMs < 0 || nowMs < endedAtMs) return 0
    val elapsed = nowMs - endedAtMs
    return if (elapsed >= NATIVE_CALL_COOLDOWN_MS) 0 else NATIVE_CALL_COOLDOWN_MS - elapsed
}

internal fun nativeCallCooldownSeconds(remainingMs: Long): Int =
    ((remainingMs.coerceIn(0, NATIVE_CALL_COOLDOWN_MS) + 999) / 1000).toInt()
