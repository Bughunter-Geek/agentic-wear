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

/** Completed turns and questions lead with the agent's reply preview; other kinds keep the status summary first. */
internal fun notificationTexts(kind: io.github.sirbughunter.agenticwear.model.AlertKind, summary: String, detail: String): NotificationTexts =
    if (kind == io.github.sirbughunter.agenticwear.model.AlertKind.COMPLETE ||
        kind == io.github.sirbughunter.agenticwear.model.AlertKind.QUESTION
    ) {
        NotificationTexts(contentText = detail, subText = summary, bigText = detail)
    } else {
        NotificationTexts(contentText = summary, subText = detail, bigText = "$summary\n$detail")
    }

/** Request code for the explicit "Open" action; must differ from the content intent's eventId hash. */
internal fun openActionRequestCode(eventId: String): Int = eventId.hashCode() xor 0x4F50454E

/** Only completed turns get an explicit Open action. */
internal fun notificationHasOpenAction(kind: io.github.sirbughunter.agenticwear.model.AlertKind): Boolean =
    kind == io.github.sirbughunter.agenticwear.model.AlertKind.COMPLETE

internal const val MAX_QUESTION_ACTION_OPTIONS = 3
internal const val QUESTION_ACTION_LABEL_CHARS = 20

internal data class QuestionAction(
    val label: String,
    /** The option text sent as the answer; null for the Open / Reply action. */
    val answer: String?,
    /** Request-code slot: option index, or [io.github.sirbughunter.agenticwear.model.OPEN_REQUEST_SLOT]. */
    val slot: Int,
)

internal fun ellipsizeActionLabel(label: String): String {
    val clean = label.trim().replace(Regex("\\s+"), " ")
    return if (clean.length <= QUESTION_ACTION_LABEL_CHARS) clean else clean.take(QUESTION_ACTION_LABEL_CHARS - 1).trimEnd() + "…"
}

/**
 * Up to three option actions plus "Open"; without options a single "Reply" that opens the reply input.
 * Option actions launch MainActivity (background apps have no network), which sends the answer.
 */
internal fun questionNotificationActions(options: List<String>): List<QuestionAction> {
    val usable = options.map(String::trim).filter(String::isNotEmpty).take(MAX_QUESTION_ACTION_OPTIONS)
    if (usable.isEmpty()) {
        return listOf(QuestionAction("Reply", null, io.github.sirbughunter.agenticwear.model.OPEN_REQUEST_SLOT))
    }
    return usable.mapIndexed { index, option -> QuestionAction(ellipsizeActionLabel(option), option, index) } +
        QuestionAction("Open", null, io.github.sirbughunter.agenticwear.model.OPEN_REQUEST_SLOT)
}
