package io.github.sirbughunter.agenticwear.notification

internal fun alertVibrationPattern(): LongArray = longArrayOf(0, 1_000)

internal fun shouldPostAlertNotification(
    notify: Boolean,
    occurredAtMillis: Long,
    notifyAfterMillis: Long?,
): Boolean = notify && (notifyAfterMillis == null || occurredAtMillis >= notifyAfterMillis)
