package io.github.sirbughunter.agenticwear.notification

import io.github.sirbughunter.agenticwear.model.AlertKind
import io.github.sirbughunter.agenticwear.model.OPEN_REQUEST_SLOT
import io.github.sirbughunter.agenticwear.model.optimisticQuestionReplyText
import io.github.sirbughunter.agenticwear.model.questionActionRequestCode
import io.github.sirbughunter.agenticwear.model.questionEventId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QuestionNotificationPolicyTest {
    @Test
    fun `question buzzes in the background and pops in the foreground`() {
        assertEquals(AlertPresentation.NOTIFY, alertPresentation(true, true, false))
        assertEquals(AlertPresentation.POP, alertPresentation(true, true, true))
        assertEquals(AlertPresentation.NONE, alertPresentation(false, true, false))
    }

    @Test
    fun `a completed turn that carries a question gets no notification or pop`() {
        // The repository clears shouldNotify when hasQuestion is set.
        assertEquals(AlertPresentation.NONE, alertPresentation(true, false, false))
        assertEquals(AlertPresentation.NONE, alertPresentation(true, false, true))
    }

    @Test
    fun `question text leads with the detail like finished replies`() {
        val t = notificationTexts(AlertKind.QUESTION, "Question · 9:41", "Which branch?")
        assertEquals("Which branch?", t.contentText)
        assertEquals("Which branch?", t.bigText)
        assertEquals("Question · 9:41", t.subText)
    }

    @Test
    fun `option actions are capped at three plus Open`() {
        val actions = questionNotificationActions(listOf("Yes", "No", "Maybe", "Later"))
        assertEquals(listOf("Yes", "No", "Maybe", "Open"), actions.map { it.label })
        assertEquals(listOf("Yes", "No", "Maybe", null), actions.map { it.answer })
        assertEquals(listOf(0, 1, 2, OPEN_REQUEST_SLOT), actions.map { it.slot })
    }

    @Test
    fun `no options means a single Reply action`() {
        val actions = questionNotificationActions(emptyList())
        assertEquals(listOf("Reply"), actions.map { it.label })
        assertNull(actions.single().answer)
    }

    @Test
    fun `long labels are ellipsized but the full answer is kept`() {
        val long = "Use the staging environment and redeploy everything"
        val action = questionNotificationActions(listOf(long)).first()
        assertEquals(QUESTION_ACTION_LABEL_CHARS, action.label.length)
        assertTrue(action.label.endsWith("…"))
        assertEquals(long, action.answer)
    }

    @Test
    fun `request codes are unique per event and action and differ from the open action`() {
        val events = (1..40).map { questionEventId("thread-$it", "item-$it") }
        val codes = events.flatMap { e -> (listOf(0, 1, 2, OPEN_REQUEST_SLOT)).map { questionActionRequestCode(e, it) } }
        assertEquals(codes.size, codes.toSet().size)
        events.forEach { e ->
            assertTrue(openActionRequestCode(e) !in (0..3).map { questionActionRequestCode(e, it) })
            assertTrue(e.hashCode() !in (0..3).map { questionActionRequestCode(e, it) })
        }
    }

    @Test
    fun `optimistic reply uses the bridge format`() {
        assertEquals("> Which one?\nBlue", optimisticQuestionReplyText("Which one?", " Blue "))
        val long = "q".repeat(130)
        assertEquals("> " + "q".repeat(120) + "…\nA", optimisticQuestionReplyText(long, "A"))
        assertEquals("> a b\nx", optimisticQuestionReplyText("a\n b", "x"))
    }
}
