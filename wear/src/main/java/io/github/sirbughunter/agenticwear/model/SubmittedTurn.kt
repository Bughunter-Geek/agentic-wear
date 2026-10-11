package io.github.sirbughunter.agenticwear.model

enum class SubmissionPhase { SENDING, QUEUED, ACCEPTED, RUNNING, COMPLETED, FAILED, UNCERTAIN }

data class SubmittedTurn(
    val requestId: String,
    val threadId: String?,
    val text: String,
    val createdAtMillis: Long,
    val phase: SubmissionPhase = SubmissionPhase.SENDING,
    val nativeTurnId: String? = null,
    val nativeMessageId: String? = null,
) {
    fun matches(message: ChatMessage): Boolean = message.role == ChatRole.USER &&
        (message.watchRequestId == requestId || message.id == requestId || message.id == nativeMessageId ||
            (nativeTurnId != null && message.turnId == nativeTurnId && message.text == text))

    fun progress(next: SubmissionPhase, thread: String? = threadId, turn: String? = nativeTurnId): SubmittedTurn {
        if (phase == SubmissionPhase.COMPLETED) return copy(threadId = thread ?: threadId, nativeTurnId = turn ?: nativeTurnId)
        val resolved = when {
            phase == SubmissionPhase.FAILED && next != SubmissionPhase.COMPLETED -> phase
            phase in setOf(SubmissionPhase.ACCEPTED, SubmissionPhase.RUNNING) && next in setOf(SubmissionPhase.SENDING, SubmissionPhase.QUEUED) -> phase
            phase == SubmissionPhase.RUNNING && next == SubmissionPhase.ACCEPTED -> phase
            else -> next
        }
        return copy(threadId = thread ?: threadId, nativeTurnId = turn ?: nativeTurnId, phase = resolved)
    }

    fun reconcile(snapshot: ChatSnapshot): SubmittedTurn {
        if (threadId != snapshot.threadId) return this
        val user = snapshot.messages.firstOrNull(::matches)
        val turn = user?.turnId ?: nativeTurnId ?: return this
        val final = snapshot.messages.any { it.turnId == turn && it.role == ChatRole.ASSISTANT && it.phase == ChatPhase.FINAL_ANSWER }
        val running = snapshot.status == SessionStatus.ACTIVE && snapshot.messages.lastOrNull()?.turnId == turn
        return copy(nativeTurnId = turn, nativeMessageId = user?.id ?: nativeMessageId,
            phase = when {
                final || phase == SubmissionPhase.COMPLETED -> SubmissionPhase.COMPLETED
                phase == SubmissionPhase.FAILED -> phase
                running -> SubmissionPhase.RUNNING
                user != null && phase == SubmissionPhase.SENDING -> SubmissionPhase.ACCEPTED
                else -> phase
            })
    }
}

/** Retain the local echo until its exact request/turn has a canonical user message. */
fun submittedChatMessages(snapshot: ChatSnapshot?, submissions: List<SubmittedTurn>): List<ChatMessage> {
    val messages = snapshot?.messages.orEmpty().toMutableList()
    for (submission in submissions) {
        if (snapshot != null && submission.threadId != snapshot.threadId) continue
        if (messages.any(submission::matches)) continue
        val turnIndex = messages.indexOfFirst { it.turnId == submission.nativeTurnId }
        // The canonical history owns completed turns; a stale failed/uncertain echo must not trail newer messages.
        if (submission.phase == SubmissionPhase.COMPLETED) continue
        if (isSuperseded(submission, submissions)) continue
        val echo = ChatMessage("watch-local-${submission.requestId}", submission.nativeTurnId ?: "watch-local-${submission.requestId}",
            ChatRole.USER, submission.text, ChatPhase.UNKNOWN, watchRequestId = submission.requestId)
        messages.add(if (turnIndex >= 0) turnIndex else messages.size, echo)
    }
    return messages
}

fun submissionPhaseFromWire(value: String): SubmissionPhase? = when (value) {
    "queued", "waiting", "paused" -> SubmissionPhase.QUEUED
    "dispatching", "accepted" -> SubmissionPhase.ACCEPTED
    "running" -> SubmissionPhase.RUNNING
    "completed" -> SubmissionPhase.COMPLETED
    "failed", "expired" -> SubmissionPhase.FAILED
    "uncertain", "reconnecting" -> SubmissionPhase.UNCERTAIN
    else -> null
}

fun submissionStatusLabel(submission: SubmittedTurn, checking: Boolean, snapshot: ChatSnapshot?): String = when (submission.phase) {
    SubmissionPhase.SENDING -> "Sending…"
    SubmissionPhase.QUEUED -> "Queued · waiting to start"
    SubmissionPhase.ACCEPTED -> "Sent · awaiting response"
    SubmissionPhase.RUNNING -> "Working"
    SubmissionPhase.COMPLETED -> if (snapshot?.messages?.any { it.turnId == submission.nativeTurnId && it.role == ChatRole.ASSISTANT && it.phase == ChatPhase.FINAL_ANSWER } == true) "Reply received" else "Reply ready · syncing history"
    SubmissionPhase.FAILED -> "Needs attention · message preserved"
    SubmissionPhase.UNCERTAIN -> if (checking) "Checking delivery…" else "Delivery unconfirmed · check status"
}

/** Completed feedback yields to a later native turn, while an unseen reply remains syncing. */
fun currentSubmission(snapshot: ChatSnapshot?, submissions: List<SubmittedTurn>): SubmittedTurn? {
    val latest = submissions.lastOrNull() ?: return null
    if (latest.phase != SubmissionPhase.COMPLETED || snapshot == null) return latest
    val ownLastIndex = snapshot.messages.indexOfLast { it.turnId == latest.nativeTurnId || latest.matches(it) }
    if (ownLastIndex >= 0 && snapshot.messages.drop(ownLastIndex + 1).any { it.turnId != latest.nativeTurnId }) return null
    if (ownLastIndex < 0 && latest.nativeMessageId != null && snapshot.messages.isNotEmpty()) return null
    return latest
}

fun terminalSubmissionPhase(kind: String, deliveryState: String, current: SubmissionPhase): SubmissionPhase =
    if (kind == "terminal.completed") SubmissionPhase.COMPLETED
    else submissionPhaseFromWire(deliveryState) ?: if (current == SubmissionPhase.UNCERTAIN) current else SubmissionPhase.FAILED

private val LIVE_PHASES = setOf(SubmissionPhase.QUEUED, SubmissionPhase.ACCEPTED, SubmissionPhase.RUNNING, SubmissionPhase.COMPLETED)

/**
 * A failed/uncertain send is superseded once a newer send in the same thread got through; an
 * in-flight one is superseded once a newer send in the same thread COMPLETED (turns are sequential).
 */
fun isSuperseded(item: SubmittedTurn, all: List<SubmittedTurn>): Boolean {
    val newer = all.filter { it.requestId != item.requestId && it.threadId == item.threadId && it.createdAtMillis > item.createdAtMillis }
    return when (item.phase) {
        SubmissionPhase.FAILED, SubmissionPhase.UNCERTAIN -> newer.any { it.phase in LIVE_PHASES }
        SubmissionPhase.SENDING, SubmissionPhase.QUEUED, SubmissionPhase.ACCEPTED, SubmissionPhase.RUNNING ->
            newer.any { it.phase == SubmissionPhase.COMPLETED }
        SubmissionPhase.COMPLETED -> false
    }
}

/** Submissions worth showing as status/echo: stale failed/uncertain ones are hidden. */
fun visibleSubmissions(all: List<SubmittedTurn>): List<SubmittedTurn> = all.filterNot { isSuperseded(it, all) }

const val COMPLETED_RETENTION_MILLIS = 60 * 60 * 1000L
const val STALE_SEND_RETENTION_MILLIS = 24 * 60 * 60 * 1000L

/** Storage pruning; in-flight items are only dropped by the 24 h staleness rule. */
fun pruneSubmittedTurns(items: List<SubmittedTurn>, nowMillis: Long): List<SubmittedTurn> = items.filter { item ->
    val age = nowMillis - item.createdAtMillis
    when (item.phase) {
        SubmissionPhase.FAILED, SubmissionPhase.UNCERTAIN -> !isSuperseded(item, items) && age <= STALE_SEND_RETENTION_MILLIS
        SubmissionPhase.COMPLETED -> age <= COMPLETED_RETENTION_MILLIS &&
            items.none { it.requestId != item.requestId && it.threadId == item.threadId && it.createdAtMillis > item.createdAtMillis }
        else -> !isSuperseded(item, items) && age <= STALE_SEND_RETENTION_MILLIS
    }
}

/** Local dismissal only; nothing is sent. */
fun dismissSubmittedTurn(items: List<SubmittedTurn>, requestId: String): List<SubmittedTurn> =
    items.filterNot { it.requestId == requestId }
