package io.github.sirbughunter.agenticwear.data

import org.junit.Assert.*
import org.junit.Test

class RecentInboxMessagesTest {
    @Test fun repeatedRelayMessageIsRecognizedOnlyAfterItWasHandled() {
        val recent = RecentInboxMessages()
        assertFalse(recent.handled("m1"))
        recent.remember("m1")
        assertTrue(recent.handled("m1"))
        assertFalse(recent.handled("m2"))
    }
    @Test fun blankIdsAreNeverDeduplicated() {
        val recent = RecentInboxMessages()
        recent.remember("")
        assertFalse(recent.handled(""))
    }
    @Test fun boundedToTheMostRecentIds() {
        val recent = RecentInboxMessages(capacity = 3)
        listOf("a", "b", "c").forEach(recent::remember)
        recent.remember("a") // refreshed: now the newest
        recent.remember("d")
        assertFalse(recent.handled("b"))
        assertTrue(listOf("a", "c", "d").all(recent::handled))
    }
}
