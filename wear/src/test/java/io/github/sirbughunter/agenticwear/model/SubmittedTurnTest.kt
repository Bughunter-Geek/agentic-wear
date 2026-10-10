package io.github.sirbughunter.agenticwear.model

import org.junit.Assert.*
import org.junit.Test

class SubmittedTurnTest {
    private val sent = SubmittedTurn("request-1", "chat", "This is just a test.", 1791576000000L)
    private fun user(id: String = "native-user", request: String? = "request-1", turn: String = "turn-1") =
        ChatMessage(id, turn, ChatRole.USER, sent.text, ChatPhase.UNKNOWN, watchRequestId = request)
    private fun answer(turn: String = "turn-1") = ChatMessage("answer", turn, ChatRole.ASSISTANT, "Received.", ChatPhase.FINAL_ANSWER)
    private fun snapshot(vararg messages: ChatMessage, status: SessionStatus = SessionStatus.IDLE) =
        ChatSnapshot("chat", "Task", status, emptyList(), 1791576001000L, messages = messages.toList())

    @Test fun inputIsVisibleBeforeAnyNativeHistoryArrives() {
        val visible = submittedChatMessages(null, listOf(sent))
        assertEquals(sent.text, visible.single().text)
        assertEquals(ChatRole.USER, visible.single().role)
        assertEquals("Sending…", submissionStatusLabel(sent, true, null))
    }
    @Test fun oldIdenticalTextDoesNotAcknowledgeANewRequest() {
        val old = snapshot(user("old-user", null, "old-turn"))
        assertEquals(2, submittedChatMessages(old, listOf(sent)).size)
        assertNull(sent.reconcile(old).nativeMessageId)
    }
    @Test fun exactCloudRequestReplacesLocalEcho() {
        val native = snapshot(user())
        assertEquals(1, submittedChatMessages(native, listOf(sent)).size)
        assertEquals("native-user", sent.reconcile(native).nativeMessageId)
    }
    @Test fun localClientMessageIdentityAlsoReplacesEcho() {
        val native = snapshot(user("request-1", null))
        assertEquals(1, submittedChatMessages(native, listOf(sent)).size)
    }
    @Test fun canonicalMessageCanReplaceLocalClientIdWithinTheKnownTurn() {
        val first = sent.reconcile(snapshot(user("request-1", null)))
        val later = snapshot(user("canonical-user", null))
        assertEquals("canonical-user", first.reconcile(later).nativeMessageId)
        assertEquals(1, submittedChatMessages(later, listOf(first)).size)
    }
    @Test fun matchingFinalAnswerStopsWorkingEvenIfSnapshotSaysActive() {
        val native = snapshot(user(), answer(), status = SessionStatus.ACTIVE)
        val done = sent.reconcile(native)
        assertEquals(SubmissionPhase.COMPLETED, done.phase)
        assertEquals("Reply received", submissionStatusLabel(done, false, native))
        assertEquals(SubmissionPhase.COMPLETED, done.progress(SubmissionPhase.QUEUED).phase)
        assertEquals(SubmissionPhase.COMPLETED, done.reconcile(snapshot(user(), status = SessionStatus.ACTIVE)).phase)
    }
    @Test fun unrelatedAnswerCannotCompleteThisSubmission() {
        val current = sent.reconcile(snapshot(user(), answer("other-turn")))
        assertNotEquals(SubmissionPhase.COMPLETED, current.phase)
    }
    @Test fun typedCompletionDoesNotPretendHistoryHasArrived() {
        val done = sent.progress(SubmissionPhase.COMPLETED, turn = "turn-1")
        assertEquals("Reply ready · syncing history", submissionStatusLabel(done, false, snapshot()))
    }
    @Test fun finalCanReconcileWhenUserMessageFallsOutsideSnapshot() {
        val known = sent.copy(nativeTurnId = "turn-1", nativeMessageId = "native-user")
        assertEquals(SubmissionPhase.COMPLETED, known.reconcile(snapshot(answer())).phase)
    }
    @Test fun completedHistoryThatAgedOutIsNotAppendedAsANewMessage() {
        val old = sent.copy(phase = SubmissionPhase.COMPLETED, nativeTurnId = "old-turn", nativeMessageId = "old-user")
        assertEquals(1, submittedChatMessages(snapshot(answer()), listOf(old)).size)
    }
    @Test fun queuedAndUnconfirmedAreNotPresentedAsWorking() {
        assertEquals(SubmissionPhase.QUEUED, submissionPhaseFromWire("paused"))
        assertEquals("Queued · waiting to start", submissionStatusLabel(sent.copy(phase = SubmissionPhase.QUEUED), false, null))
        assertEquals("Checking delivery…", submissionStatusLabel(sent.copy(phase = SubmissionPhase.UNCERTAIN), true, null))
    }
    @Test fun failureKeepsOriginalTextVisibleForReview() {
        assertEquals(sent.text, submittedChatMessages(snapshot(), listOf(sent.copy(phase = SubmissionPhase.FAILED))).single().text)
    }
    @Test fun unrelatedChatDoesNotDisplayThisLocalSubmission() {
        assertTrue(submittedChatMessages(snapshot().copy(threadId = "other"), listOf(sent)).isEmpty())
    }
    @Test fun laterNativeTurnOwnsCurrentWorkingState() {
        val done = sent.reconcile(snapshot(user(), answer()))
        assertNull(currentSubmission(snapshot(user(), answer(), user("next-user", "next-request", "next-turn"), status = SessionStatus.ACTIVE), listOf(done)))
        assertEquals(done, currentSubmission(snapshot(user(), answer(), status = SessionStatus.ACTIVE), listOf(done)))
    }
    @Test fun completedFeedbackCanAcquireNativeIdentityWithoutRegressing() {
        val done = sent.progress(SubmissionPhase.COMPLETED).progress(SubmissionPhase.RUNNING, turn = "turn-1")
        assertEquals(SubmissionPhase.COMPLETED, done.phase)
        assertEquals("turn-1", done.nativeTurnId)
    }
    @Test fun completedButUnseenReplyStillShowsSyncingWithOlderHistory() {
        val done = sent.progress(SubmissionPhase.COMPLETED, turn = "turn-1")
        assertEquals(done, currentSubmission(snapshot(answer("old-turn")), listOf(done)))
    }
    @Test fun uncertainTerminalNeverOffersANewMessageAsIfDeliveryHadFailed() {
        assertEquals(SubmissionPhase.UNCERTAIN, terminalSubmissionPhase("terminal.failed", "uncertain", SubmissionPhase.ACCEPTED))
        assertEquals(SubmissionPhase.UNCERTAIN, terminalSubmissionPhase("terminal.failed", "", SubmissionPhase.UNCERTAIN))
        assertEquals(SubmissionPhase.FAILED, terminalSubmissionPhase("terminal.failed", "failed", SubmissionPhase.UNCERTAIN))
        assertEquals(SubmissionPhase.COMPLETED, terminalSubmissionPhase("terminal.completed", "completed", SubmissionPhase.UNCERTAIN))
    }
}
