package io.github.sirbughunter.agenticwear.data

import io.github.sirbughunter.agenticwear.model.AlertKind
import io.github.sirbughunter.agenticwear.model.BridgePayload
import io.github.sirbughunter.agenticwear.model.ChatQuestion
import io.github.sirbughunter.agenticwear.model.ChatRole
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QuestionPayloadTest {
    private fun questionEvent() = JSONObject()
        .put("version", 1).put("kind", "question.request")
        .put("eventId", "question:t1:item_9").put("threadId", "t1")
        .put("title", "My chat").put("detail", "Which branch should I use?")
        .put("options", JSONArray(listOf("main", "dev", "main", " ", "a", "b", "c")))
        .put("questionItemId", "item_9").put("questionIndex", 0).put("occurredAt", 1234L)

    @Test
    fun `question request decodes into a question alert`() {
        val alert = PayloadCodec.decodeAlert(questionEvent())!!
        assertEquals(AlertKind.QUESTION, alert.kind)
        assertEquals("Which branch should I use?", alert.detail)
        assertEquals(listOf("main", "dev", "a", "b"), alert.options)
        assertEquals("item_9", alert.questionItemId)
        assertEquals(0, alert.questionIndex)
        assertTrue(acceptsAlertEnvelope("question.request", ""))
    }

    @Test
    fun `question alert survives storage and unsafe ids are rejected`() {
        val alert = PayloadCodec.decodeAlert(questionEvent())!!
        val restored = PayloadCodec.alertFromJson(PayloadCodec.alertToJson(alert))!!
        assertEquals(alert, restored)
        assertNull(PayloadCodec.decodeAlert(questionEvent().put("questionItemId", "bad id!"))!!.questionItemId)
        assertEquals(9, PayloadCodec.decodeAlert(questionEvent().put("questionIndex", 99))!!.questionIndex)
    }

    @Test
    fun `terminal completed reports hasQuestion only when set`() {
        val base = JSONObject().put("kind", "terminal.completed")
        assertFalse(PayloadCodec.hasQuestion(base))
        assertTrue(PayloadCodec.hasQuestion(JSONObject(base.toString()).put("hasQuestion", true)))
        assertFalse(PayloadCodec.hasQuestion(JSONObject().put("kind", "terminal.failed").put("hasQuestion", true)))
    }

    @Test
    fun `completed alerts keep line breaks for markdown`() {
        val json = JSONObject().put("version", 1).put("kind", "terminal.completed").put("turnScope", "topLevel")
            .put("eventId", "e1").put("threadId", "t1").put("detail", "# Done\n\n- a\n- b")
        assertEquals("# Done\n\n- a\n- b", PayloadCodec.decodeAlert(json)!!.detail)
    }

    @Test
    fun `chat snapshot decodes questions and older bridges need none`() {
        fun snapshot(extra: JSONObject.() -> Unit) = JSONObject()
            .put("version", 1).put("kind", "chat.snapshot").put("threadId", "t1").put("title", "T").put("status", "idle")
            .put(
                "messages",
                JSONArray().put(
                    JSONObject().put("id", "m1").put("turnId", "u1").put("role", "assistant").put("text", "Pick one")
                        .put("phase", "final_answer").apply(extra),
                ),
            )
        val plain = PayloadCodec.decodeChatSnapshot(snapshot {})!!.messages.single()
        assertTrue(plain.questions.isEmpty())
        assertNull(plain.questionItemId)
        assertFalse(plain.answered)
        assertFalse(plain.needsAnswer)

        val asked = PayloadCodec.decodeChatSnapshot(
            snapshot {
                put("questions", JSONArray().put(JSONObject().put("title", "Which?").put("options", JSONArray(listOf("A", "B")))))
                put("questionItemId", "item_1")
            },
        )!!
        val message = asked.messages.single()
        assertEquals(ChatQuestion("Which?", listOf("A", "B")), message.questions.single())
        assertTrue(message.needsAnswer)
        assertFalse(PayloadCodec.decodeChatSnapshot(snapshot {
            put("questions", JSONArray().put(JSONObject().put("title", "Which?")))
            put("questionItemId", "item_1"); put("answered", true)
        })!!.messages.single().needsAnswer)

        val stored = PayloadCodec.chatSnapshotFromJson(PayloadCodec.chatSnapshotToJson(asked))!!
        assertEquals(message.questions, stored.messages.single().questions)
        assertEquals("item_1", stored.messages.single().questionItemId)
        assertEquals(ChatRole.ASSISTANT, stored.messages.single().role)
    }

    @Test
    fun `question answer payload matches the contract`() {
        val json = JSONObject(
            PayloadCodec.encode(
                BridgePayload.AnswerQuestion("req-1", "t1", "item_9", 0, "  main  ", "Which branch?"),
            ),
        )
        assertEquals("question.answer", json.getString("kind"))
        assertEquals(1, json.getInt("version"))
        assertEquals("req-1", json.getString("requestId"))
        assertEquals("t1", json.getString("threadId"))
        assertEquals("item_9", json.getString("questionItemId"))
        assertEquals(0, json.getInt("questionIndex"))
        assertEquals("main", json.getString("answer"))
        assertEquals("Which branch?", json.getString("question"))
        val bare = JSONObject(PayloadCodec.encode(BridgePayload.AnswerQuestion("r", "t", "i", 3, "x", null)))
        assertFalse(bare.has("question"))
        val long = JSONObject(PayloadCodec.encode(BridgePayload.AnswerQuestion("r", "t", "i", 3, "x", "q".repeat(2_000))))
        assertEquals(1_000, long.getString("question").length)
        assertNotNull(long)
    }
}
