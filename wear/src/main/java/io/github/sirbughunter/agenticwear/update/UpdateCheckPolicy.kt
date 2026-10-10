package io.github.sirbughunter.agenticwear.update

/**
 * When to re-check for an app update on returning to the foreground (screen on, app switch, reopen).
 * Throttled only by the last *successful* check, so a check that failed while Wi-Fi was still waking
 * does not hide a new release; a short attempt spacing avoids hammering on rapid wake/sleep.
 */
internal object UpdateCheckPolicy {
    const val SUCCESS_INTERVAL_MS = 60_000L
    const val ATTEMPT_SPACING_MS = 5_000L
    const val SILENT_FAILURE_RETRY_MS = 10_000L

    fun shouldCheckOnForeground(nowMs: Long, lastSuccessMs: Long?, lastAttemptMs: Long?): Boolean =
        (lastSuccessMs == null || nowMs - lastSuccessMs >= SUCCESS_INTERVAL_MS) &&
            (lastAttemptMs == null || nowMs - lastAttemptMs >= ATTEMPT_SPACING_MS)
}
