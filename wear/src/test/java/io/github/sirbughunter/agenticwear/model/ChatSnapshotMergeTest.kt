package io.github.sirbughunter.agenticwear.model

import io.github.sirbughunter.agenticwear.data.PayloadCodec
import io.github.sirbughunter.agenticwear.data.shouldAcceptChatSnapshot
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatSnapshotMergeTest {
    private fun msg(id: String, text: String = id) = ChatMessage(id, "turn", ChatRole.ASSISTANT, text, ChatPhase.FINAL_ANSWER)
    private fun snap(ids: List<String>, partial: Boolean = false, at: Long = 1, thread: String = "t", title: String = "T") =
        ChatSnapshot(thread, title, SessionStatus.IDLE, emptyList(), at, messages = ids.map { msg(it) }, partial = partial)
    private fun ids(s: ChatSnapshot) = s.messages.map { it.id }

    @Test
    fun `overlap keeps current up to first shared id then appends incoming`() {
        val merged = mergeChatSnapshot(snap(listOf("a", "b", "c", "d")), snap(listOf("c", "d", "e"), partial = true, title = "New"))
        assertEquals(listOf("a", "b", "c", "d", "e"), ids(merged))
        assertEquals("New", merged.title)
    }

    @Test
    fun `no overlap appends and dedupes and caps at twelve newest`() {
        assertEquals(listOf("a", "b", "x", "y"), ids(mergeChatSnapshot(snap(listOf("a", "b")), snap(listOf("x", "y", "x"), partial = true))))
        val current = snap((1..12).map { "m$it" })
        val merged = mergeChatSnapshot(current, snap(listOf("n1", "n2"), partial = true))
        assertEquals(12, merged.messages.size)
        assertEquals(listOf("n1", "n2"), ids(merged).takeLast(2))
        assertEquals("m3", merged.messages.first().id)
    }

    @Test
    fun `non-partial or other thread replaces`() {
        val full = snap(listOf("x"))
        assertEquals(listOf("x"), ids(mergeChatSnapshot(snap(listOf("a", "b")), full)))
        assertEquals(listOf("x"), ids(mergeChatSnapshot(snap(listOf("a"), thread = "other"), snap(listOf("x"), partial = true))))
        assertEquals(listOf("x"), ids(mergeChatSnapshot(null, snap(listOf("x"), partial = true))))
    }

    @Test
    fun `partial flag decodes and same generatedAt full snapshot is accepted`() {
        val json = JSONObject().put("version", 1).put("kind", "chat.snapshot").put("threadId", "t").put("partial", true)
        assertTrue(PayloadCodec.decodeChatSnapshot(json)!!.partial)
        assertFalse(PayloadCodec.decodeChatSnapshot(json.put("partial", false))!!.partial)
        assertTrue(shouldAcceptChatSnapshot("t", null, 500, "t", null, 500))
    }

    @Test
    fun `model selection hidden for dot and cloud only`() {
        assertFalse(supportsModelSelection("dot"))
        assertFalse(supportsModelSelection("cloud"))
        assertTrue(supportsModelSelection(null))
        assertTrue(supportsModelSelection("automation"))
    }
}
