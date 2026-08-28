package io.github.sirbughunter.agenticwear.ui

internal fun elapsedRealtimeDelta(startedAtMillis: Long, nowMillis: Long): Long =
    (nowMillis - startedAtMillis).coerceAtLeast(0L)

internal fun formatTranscriptionElapsed(elapsedMillis: Long): String {
    val totalTenths = elapsedMillis.coerceAtLeast(0L) / 100L
    if (totalTenths < 600L) return "${totalTenths / 10L}.${totalTenths % 10L} s"

    val totalSeconds = totalTenths / 10L
    val minutes = totalSeconds / 60L
    val seconds = totalSeconds % 60L
    return "$minutes:${seconds.toString().padStart(2, '0')}.${totalTenths % 10L}"
}
