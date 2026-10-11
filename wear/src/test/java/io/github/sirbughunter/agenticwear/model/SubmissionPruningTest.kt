package io.github.sirbughunter.agenticwear.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SubmissionPruningTest {
    private val hour = 60 * 60 * 1000L
    private val now = 100 * hour
    private fun turn(id: String, phase: SubmissionPhase, at: Long, thread: String? = "t", nativeMessageId: String? = null) =
        SubmittedTurn(id, thread, "text $id", at, phase, nativeMessageId = nativeMessageId)

    private fun snapshot(vararg m: ChatMessage) = ChatSnapshot("t", "T", SessionStatus.IDLE, emptyList(), 0L, messages = m.toList())
    private fun real(id: String) = ChatMessage(id, "turn-$id", ChatRole.ASSISTANT, "reply", ChatPhase.FINAL_ANSWER)

    @Test
    fun `superseded failed and uncertain are not rendered, latest failed is at the end`() {
        val subs = listOf(
            turn("f1", SubmissionPhase.FAILED, 1), turn("u1", SubmissionPhase.UNCERTAIN, 2),
            turn("ok", SubmissionPhase.RUNNING, 3), turn("f2", SubmissionPhase.FAILED, 4),
        )
        val out = submittedChatMessages(snapshot(real("a"), real("b")), subs)
        assertEquals(listOf("a", "b", "watch-local-ok", "watch-local-f2"), out.map { it.id })
        assertTrue(isSuperseded(subs[0], subs))
        assertTrue(!isSuperseded(subs[3], subs))
    }

    @Test
    fun `unmatched completed is not rendered but in-flight sending still is`() {
        val subs = listOf(turn("c", SubmissionPhase.COMPLETED, 1), turn("s", SubmissionPhase.SENDING, 2))
        assertEquals(listOf("a", "watch-local-s"), submittedChatMessages(snapshot(real("a")), subs).map { it.id })
    }

    @Test
    fun `on-load cleanup leaves nothing stale`() {
        val list = listOf(
            turn("f1", SubmissionPhase.FAILED, now - 5 * hour), turn("u1", SubmissionPhase.UNCERTAIN, now - 4 * hour),
            turn("f2", SubmissionPhase.FAILED, now - 3 * hour), turn("c", SubmissionPhase.COMPLETED, now - 10 * 60_000L),
        )
        assertEquals(listOf("c"), pruneSubmittedTurns(list, now).map { it.requestId })
    }

    @Test
    fun `pruning rules by age and seen`() {
        val list = listOf(
            turn("failed-latest", SubmissionPhase.FAILED, now - 2 * hour),
            turn("failed-ancient", SubmissionPhase.FAILED, now - 25 * hour, thread = "other"),
            turn("done-seen", SubmissionPhase.COMPLETED, now - 1000, thread = "x", nativeMessageId = "m"),
            turn("done-old-sup", SubmissionPhase.COMPLETED, now - 2000, thread = "v"),
            turn("newer-sending", SubmissionPhase.SENDING, now - 1000, thread = "v"),
            turn("done-old", SubmissionPhase.COMPLETED, now - 2 * hour, thread = "y"),
            turn("sending-old", SubmissionPhase.SENDING, now - 10 * hour, thread = "z"),
            turn("running", SubmissionPhase.RUNNING, now - 20 * hour, thread = "w"),
        )
        assertEquals(listOf("failed-latest", "done-seen", "newer-sending", "sending-old", "running"), pruneSubmittedTurns(list, now).map { it.requestId })
    }

    @Test
    fun `dismiss removes only that item`() {
        val list = listOf(turn("a", SubmissionPhase.FAILED, 1, "t1"), turn("b", SubmissionPhase.FAILED, 2, "t2"))
        assertEquals(listOf("b"), dismissSubmittedTurn(list, "a").map { it.requestId })
        assertEquals(list, dismissSubmittedTurn(list, "none"))
    }

    @Test
    fun `in-flight items are superseded by a newer completed one or by age`() {
        val list = listOf(
            turn("old-run", SubmissionPhase.RUNNING, now - 3 * hour),
            turn("new-done", SubmissionPhase.COMPLETED, now - 60_000L),
            turn("alone", SubmissionPhase.RUNNING, now - 5 * hour, thread = "o"),
            turn("ancient", SubmissionPhase.ACCEPTED, now - 25 * hour, thread = "p"),
        )
        assertEquals(listOf("new-done", "alone"), pruneSubmittedTurns(list, now).map { it.requestId })
        assertEquals(listOf("a"), submittedChatMessages(snapshot(real("a")), visibleSubmissions(list.filter { it.threadId == "t" })).map { it.id })
        assertEquals(listOf("a", "watch-local-alone"), submittedChatMessages(snapshot(real("a")), list.filter { it.threadId == "o" }.map { it.copy(threadId = "t") }).map { it.id })
    }
}

class DismissStuckSendTest {
    private fun turn(id: String, thread: String) = SubmittedTurn(id, thread, "t", 1L, SubmissionPhase.UNCERTAIN)

    @Test
    fun `dismiss removes the item and abandons its matching pending delivery only`() {
        val items = listOf(turn("a", "t1"), turn("b", "t2"))
        val hit = dismissStuckSend(items, "a", "a")
        assertEquals(listOf("b"), hit.items.map { it.requestId })
        assertTrue(hit.clearPendingDelivery)
        val other = dismissStuckSend(items, "b", "a")
        assertEquals(listOf("b"), other.items.map { it.requestId })
        assertEquals(false, other.clearPendingDelivery)
        assertEquals(false, dismissStuckSend(items, null, "a").clearPendingDelivery)
    }
}
