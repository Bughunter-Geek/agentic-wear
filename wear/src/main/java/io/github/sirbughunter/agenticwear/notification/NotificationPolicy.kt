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

internal data class NotificationTexts(val contentText: String, val subText: String, val bigText: String)

/** Completed turns lead with the agent's reply preview; other kinds keep the status summary first. */
internal fun notificationTexts(kind: io.github.sirbughunter.agenticwear.model.AlertKind, summary: String, detail: String): NotificationTexts =
    if (kind == io.github.sirbughunter.agenticwear.model.AlertKind.COMPLETE) {
        NotificationTexts(contentText = detail, subText = summary, bigText = detail)
    } else {
        NotificationTexts(contentText = summary, subText = detail, bigText = "$summary\n$detail")
    }

/** Request code for the explicit "Open" action; must differ from the content intent's eventId hash. */
internal fun openActionRequestCode(eventId: String): Int = eventId.hashCode() xor 0x4F50454E

/** Only completed turns get an explicit Open action. */
internal fun notificationHasOpenAction(kind: io.github.sirbughunter.agenticwear.model.AlertKind): Boolean =
    kind == io.github.sirbughunter.agenticwear.model.AlertKind.COMPLETE
