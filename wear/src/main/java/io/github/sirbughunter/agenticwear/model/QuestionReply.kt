package io.github.sirbughunter.agenticwear.model

private const val QUOTED_QUESTION_CHARS = 120

/**
 * Text of the optimistic user bubble for a question answer. Mirrors the bridge's display text for a
 * question reply (`> {question, first 120 chars + "…"}\n{answer}`) so the next snapshot replaces it
 * without a visible change.
 */
fun optimisticQuestionReplyText(question: String, answer: String): String {
    val oneLine = question.trim().replace(Regex("\\s+"), " ")
    val quoted = if (oneLine.length > QUOTED_QUESTION_CHARS) oneLine.take(QUOTED_QUESTION_CHARS) + "…" else oneLine
    return "> $quoted\n${answer.trim()}"
}

/** One tap on an answer button, a notification action or a typed reply. */
data class QuestionAnswer(
    val threadId: String,
    val questionItemId: String,
    val questionIndex: Int,
    val question: String,
    val answer: String,
)

/** A question the user chose to answer with free text through the normal reply input. */
data class PendingQuestionReply(
    val threadId: String,
    val questionItemId: String,
    val questionIndex: Int,
    val question: String,
)

fun ChatMessage.pendingQuestionReply(threadId: String): PendingQuestionReply? {
    val itemId = questionItemId?.takeIf { needsAnswer } ?: return null
    return PendingQuestionReply(threadId, itemId, 0, questions.first().title)
}

/** Whether this message's buttons are hidden because a local answer is already in flight. */
fun ChatMessage.isAnsweredLocally(answeredItemIds: Set<String>): Boolean =
    questionItemId != null && questionItemId in answeredItemIds

/**
 * Notification request codes: one per (event, action) so PendingIntents with different extras never
 * collapse into each other. Index 0..N-1 are option actions; [OPEN_REQUEST_SLOT] is the open/reply action.
 */
const val OPEN_REQUEST_SLOT = 99

fun questionActionRequestCode(eventId: String, slot: Int): Int =
    (eventId.hashCode() xor 0x51455354) * 31 + slot + 1

/** Event id the bridge uses for `question.request` (and therefore the notification id source). */
fun questionEventId(threadId: String, itemId: String): String = "question:$threadId:$itemId"
