package io.github.sirbughunter.agenticwear.ui

import io.github.sirbughunter.agenticwear.data.MAX_CHAT_LAST_OPENED
import io.github.sirbughunter.agenticwear.data.PayloadCodec
import io.github.sirbughunter.agenticwear.data.withChatOpened
import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AgentSession
import io.github.sirbughunter.agenticwear.model.AlertKind
import io.github.sirbughunter.agenticwear.model.SessionStatus
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PrioritySessionsTest {
    private fun session(id: String, status: SessionStatus = SessionStatus.IDLE, at: Long = 0, attention: String? = null) =
        AgentSession(id, id, at, status, false, false, attention = attention)

    private fun complete(thread: String, at: Long, kind: AlertKind = AlertKind.COMPLETE) =
        AgentAlert("e-$thread-$at", kind, thread, "t", "d", at)

    @Test
    fun `selects attention active unread and error only and orders by group then recency`() {
        val sessions = listOf(
            session("idle"),
            session("err", SessionStatus.ERROR, 50),
            session("run-old", SessionStatus.ACTIVE, 10),
            session("run-new", SessionStatus.ACTIVE, 20),
            session("unread", at = 5),
            session("ask-old", SessionStatus.ACTIVE, 1, attention = "question"),
            session("ask-new", SessionStatus.IDLE, 2, attention = "approval"),
        )
        val result = prioritySessions(sessions, listOf(complete("unread", 100)), emptyMap())
        assertEquals(listOf("ask-new", "ask-old", "run-new", "run-old", "unread", "err"), result.map { it.session.id })
        assertEquals(
            listOf(PriorityReason.NEEDS_YOU, PriorityReason.NEEDS_YOU, PriorityReason.WORKING, PriorityReason.WORKING, PriorityReason.NEW_REPLY, PriorityReason.ERROR),
            result.map { it.reason },
        )
    }

    @Test
    fun `unread reply clears when chat opened after the alert`() {
        val alerts = listOf(complete("a", 100), complete("b", 100, AlertKind.ERROR))
        assertTrue(hasUnreadReply("a", alerts, emptyMap()))
        assertTrue(hasUnreadReply("a", alerts, mapOf("a" to 99L)))
        assertFalse(hasUnreadReply("a", alerts, mapOf("a" to 100L)))
        assertFalse(hasUnreadReply("b", alerts, emptyMap()))
        assertTrue(prioritySessions(listOf(session("a")), alerts, mapOf("a" to 100L)).isEmpty())
    }

    @Test
    fun `no duplicates and running error chat is listed once as working`() {
        val result = prioritySessions(
            listOf(session("x", SessionStatus.ACTIVE, 1), session("x", SessionStatus.ACTIVE, 1)),
            listOf(complete("x", 5)), emptyMap(),
        )
        assertEquals(1, result.size)
        assertEquals(PriorityReason.WORKING, result.single().reason)
    }

    @Test
    fun `last opened map is bounded and keeps newest`() {
        var map = emptyMap<String, Long>()
        for (i in 1..MAX_CHAT_LAST_OPENED + 25) map = withChatOpened(map, "t$i", i.toLong())
        assertEquals(MAX_CHAT_LAST_OPENED, map.size)
        assertTrue("t${MAX_CHAT_LAST_OPENED + 25}" in map)
        assertFalse("t1" in map)
    }

    @Test
    fun `source labels`() {
        assertEquals("Cloud", sourceLabel("cloud"))
        assertEquals("Dot", sourceLabel("dot"))
        assertNull(sourceLabel(null))
        assertNull(sourceLabel("automation"))
    }

    @Test
    fun `decodes attention and source and ignores unknown values`() {
        fun snapshot(vararg s: JSONObject) = JSONObject().put("version", 1).put("kind", "sessions.snapshot").put("sessions", JSONArray(s.toList()))
        val decoded = PayloadCodec.decodeSessions(snapshot(
            JSONObject().put("id", "dot:11111111111111111111111111111111").put("title", "Dot").put("status", "active").put("source", "dot").put("attention", "question"),
            JSONObject().put("id", "00000000-0000-4000-8000-000000000001").put("title", "Cloud").put("status", "idle").put("source", "cloud").put("attention", "approval"),
            JSONObject().put("id", "mac").put("title", "Mac").put("source", "weird").put("attention", "bogus"),
        ))
        assertEquals(3, decoded.size)
        assertEquals("dot" to "question", decoded[0].source to decoded[0].attention)
        assertEquals("cloud" to "approval", decoded[1].source to decoded[1].attention)
        assertNull(decoded[2].source)
        assertNull(decoded[2].attention)
        val restored = PayloadCodec.sessionsFromJson(PayloadCodec.sessionsToJson(decoded))
        assertEquals(decoded.map { it.source to it.attention }, restored.map { it.source to it.attention })
    }

    @Test
    fun `check status is scoped to the pending request's chat`() {
        assertTrue(canCheckDeliveryHere(true, "a", "a"))
        assertFalse(canCheckDeliveryHere(true, "a", "b"))
        assertFalse(canCheckDeliveryHere(true, "a", null))
        assertFalse(canCheckDeliveryHere(false, "a", "a"))
    }

    @Test
    fun `chat snapshot keeps newest twelve messages in order`() {
        val messages = JSONArray((1..20).map {
            JSONObject().put("id", "m$it").put("turnId", "t").put("role", "assistant").put("text", "text $it").put("phase", "final_answer")
        })
        val json = JSONObject().put("version", 1).put("kind", "chat.snapshot").put("threadId", "th")
            .put("title", "x").put("status", "idle").put("messages", messages)
        val snapshot = PayloadCodec.decodeChatSnapshot(json)!!
        assertEquals((9..20).map { "m$it" }, snapshot.messages.map { it.id })
    }
}
