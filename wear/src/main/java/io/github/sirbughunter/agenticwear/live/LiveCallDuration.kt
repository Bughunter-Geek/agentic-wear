package io.github.sirbughunter.agenticwear.live

/** Elapsed session time includes reconnect gaps; a new Connect starts a new timer. */
internal fun liveCallDurationMs(startedAt: Long?, frozenMs: Long?, now: Long): Long? =
    frozenMs ?: startedAt?.let { (now - it).coerceAtLeast(0L) }

internal fun formatLiveCallDuration(durationMs: Long): String {
    val seconds = durationMs.coerceAtLeast(0L) / 1000L
    return "${(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}"
}
