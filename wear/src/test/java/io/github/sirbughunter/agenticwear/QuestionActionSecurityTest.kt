package io.github.sirbughunter.agenticwear

import io.github.sirbughunter.agenticwear.model.QuestionAnswerGuard
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QuestionActionSecurityTest {
    @Test
    fun `exported MainActivity never produces an answer from extras`() {
        // The parser has no answer input at all; only an explicit reply request opens the input.
        assertNull(parseQuestionReplyIntent("t1", "item", reply = false, index = 0, question = "q"))
        assertNull(parseQuestionReplyIntent("t1", null, reply = true, index = 0, question = "q"))
        val reply = parseQuestionReplyIntent("t1", "item", reply = true, index = 50, question = "q")!!
        assertEquals(9, reply.questionIndex)
    }

    @Test
    fun `guard lets only the first answer through until released`() {
        QuestionAnswerGuard.clearForTest()
        assertTrue(QuestionAnswerGuard.claim("item_1"))
        assertFalse(QuestionAnswerGuard.claim("item_1"))
        assertTrue(QuestionAnswerGuard.claim("item_2"))
        QuestionAnswerGuard.release("item_1")
        assertTrue(QuestionAnswerGuard.claim("item_1"))
    }

    @Test
    fun `manifest keeps the answer activity private and MainActivity has no answer path`() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        val block = manifest.substringAfter(".QuestionActionActivity").substringBefore("/>")
        assertTrue(block.contains("android:exported=\"false\""))
        assertTrue(block.contains("android:noHistory=\"true\""))
        assertTrue(block.contains("android:excludeFromRecents=\"true\""))
        assertFalse(File("src/main/java/io/github/sirbughunter/agenticwear/MainActivity.kt").readText()
            .contains("answerQuestionFromNotification"))
    }
}
