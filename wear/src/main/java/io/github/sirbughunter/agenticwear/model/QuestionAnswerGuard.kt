package io.github.sirbughunter.agenticwear.model

import java.util.concurrent.ConcurrentHashMap

/** Process-wide: a question item is answered at most once (chat tap, notification, double delivery). */
object QuestionAnswerGuard {
    private val claimed = ConcurrentHashMap.newKeySet<String>()

    /** True for the first caller; later callers must not send. */
    fun claim(questionItemId: String): Boolean = claimed.add(questionItemId)

    /** Called when the send failed so the user can answer again. */
    fun release(questionItemId: String) { claimed.remove(questionItemId) }

    internal fun clearForTest() = claimed.clear()
}
