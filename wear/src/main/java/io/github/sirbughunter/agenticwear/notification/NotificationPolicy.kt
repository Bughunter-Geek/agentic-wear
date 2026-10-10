package io.github.sirbughunter.agenticwear.notification

internal fun alertVibrationPattern(): LongArray = longArrayOf(0, 1_000)

internal fun shouldPostAlertNotification(
    notify: Boolean,
    occurredAtMillis: Long,
    notifyAfterMillis: Long?,
): Boolean = notify && (notifyAfterMillis == null || occurredAtMillis >= notifyAfterMillis)

internal enum class AlertPresentation { NONE, NOTIFY, POP }

internal fun alertPresentation(
    firstDelivery: Boolean,
    shouldNotify: Boolean,
    appInForeground: Boolean,
): AlertPresentation = when {
    !firstDelivery || !shouldNotify -> AlertPresentation.NONE
    appInForeground -> AlertPresentation.POP
    else -> AlertPresentation.NOTIFY
}

internal object AppForeground {
    @Volatile
    var isForeground: Boolean = false
}
