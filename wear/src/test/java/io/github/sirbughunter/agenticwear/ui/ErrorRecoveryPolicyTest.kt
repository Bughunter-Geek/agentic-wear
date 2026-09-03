package io.github.sirbughunter.agenticwear.ui

import io.github.sirbughunter.agenticwear.model.AgentSession
import io.github.sirbughunter.agenticwear.model.SessionStatus
import io.github.sirbughunter.agenticwear.model.Transcript
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ErrorRecoveryPolicyTest {
    @Test
    fun `long errors retain every character in the full detail and accessibility labels`() {
        val error = "Codex still owns this session in another client. " + "details ".repeat(180)

        val presentation = errorDetailPresentation(error)

        assertEquals(error, presentation.fullText)
        assertTrue(presentation.contentDescription.contains(error))
        assertEquals("Error — tap for details", presentation.compactLabel)
    }

    @Test
    fun `error accessibility guidance does not add duplicate punctuation`() {
        val presentation = errorDetailPresentation("The draft remains on this watch.")

        assertEquals(
            "Error: The draft remains on this watch. Tap for full details.",
            presentation.contentDescription,
        )
    }

    @Test
    fun `detail scroll affordance appears only while additional error text remains`() {
        assertNull(detailScrollAffordance(hasMoreContent = false))
        assertEquals("Swipe to read more ↓", detailScrollAffordance(hasMoreContent = true))
        assertNull(detailScrollAffordance(hasMoreContent = false))
    }

    @Test
    fun `detail overlay motion stays within the restrained round-watch budget`() {
        assertEquals(200, DetailOverlayMotionDurationMillis)
    }

    @Test
    fun `long permission requests retain every character in the accessibility label`() {
        val request = "Read repository status for approval. " + "scope ".repeat(180)

        assertTrue(permissionRequestContentDescription("Decision needed", request).contains(request))
    }

    @Test
    fun `foreign session errors expose refresh and explicit new session recovery`() {
        val expected = setOf(ErrorRecoveryAction.REFRESH_SESSIONS, ErrorRecoveryAction.START_NEW_SESSION)

        assertEquals(expected, recoveryActionsForError("Another Codex client owns this active session"))
        assertEquals(expected, recoveryActionsForError("Codex still owns this session in another client"))
        assertEquals(
            expected,
            recoveryActionsForError("This Codex App Server does not support queued watch prompts"),
        )
        assertEquals(
            expected,
            recoveryActionsForError("Codex could not synchronize this session after retrying. Agentic Wear did not queue or send your message, and your draft remains on the watch. Refresh sessions and retry."),
        )
    }

    @Test
    fun `temporarily unavailable chats offer refresh without discarding the selection`() {
        assertEquals(
            setOf(ErrorRecoveryAction.REFRESH_SESSIONS),
            recoveryActionsForError("The bridge could not load this session after resyncing"),
        )
    }

    @Test
    fun `starting fresh preserves the draft and never selects another session`() {
        val draft = Transcript("request-1", "Keep this prompt", "foreign-thread")
        val recovered = recoverDraftForNewSession(
            WearUiState(
                screen = WearScreen.TRANSCRIPT,
                selectedThreadId = "foreign-thread",
                transcript = draft,
                error = "active writer",
            ),
        )

        assertEquals(draft.requestId, recovered.transcript?.requestId)
        assertEquals(draft.text, recovered.transcript?.text)
        assertNull(recovered.transcript?.threadId)
        assertNull(recovered.selectedThreadId)
        assertNull(threadIdForDraftSubmission(recovered))
        assertTrue(recovered.submitDraftAsNewSession)
        assertNull(recovered.error)
        assertFalse(recovered.pending)
    }

    @Test
    fun `fresh-session destination never displays the first foreign session`() {
        val foreign = AgentSession(
            id = "foreign-thread",
            title = "Desktop-owned session",
            updatedAtMillis = 1L,
            status = SessionStatus.ACTIVE,
            ownedByWear = false,
            canAcceptDirectInput = false,
        )
        val state = WearUiState(
            sessions = listOf(foreign),
            transcript = Transcript("request-1", "Keep this prompt", "foreign-thread"),
            submitDraftAsNewSession = true,
        )

        assertEquals("Desktop-owned session", state.selectedSession?.title)
        assertEquals("New session — created only when you send", transcriptDestinationLabel(state))
    }

    @Test
    fun `normal retry targets only the draft thread or explicit selection`() {
        val draftThread = WearUiState(
            selectedThreadId = "different-thread",
            transcript = Transcript("request-1", "Retry me", "original-thread"),
        )
        val explicitSelection = WearUiState(
            selectedThreadId = "selected-thread",
            transcript = Transcript("request-2", "Send me", null),
        )
        val noDestination = WearUiState(
            sessions = listOf(
                AgentSession(
                    id = "first-foreign-thread",
                    title = "First foreign session",
                    updatedAtMillis = 1L,
                    status = SessionStatus.IDLE,
                    ownedByWear = false,
                    canAcceptDirectInput = true,
                ),
            ),
            transcript = Transcript("request-3", "Do not misroute me", null),
        )

        assertEquals("original-thread", threadIdForDraftSubmission(draftThread))
        assertEquals("selected-thread", threadIdForDraftSubmission(explicitSelection))
        assertNull(threadIdForDraftSubmission(noDestination))
    }

    @Test
    fun `start-new recovery is inert without a draft`() {
        val state = WearUiState(selectedThreadId = "foreign-thread", error = "active writer")

        assertEquals(state, recoverDraftForNewSession(state))
    }

    @Test
    fun `keystore operation failed maps to actionable user guidance`() {
        val presentation = errorDetailPresentation("Keystore operation failed")

        assertEquals("Watch security hardware was temporarily busy. Tap Retry.", presentation.fullText)
        assertTrue(presentation.contentDescription.contains("Watch security hardware was temporarily busy"))
        val actions = recoveryActionsForError("Keystore operation failed")
        assertTrue(actions.contains(ErrorRecoveryAction.REFRESH_SESSIONS))
    }
}
