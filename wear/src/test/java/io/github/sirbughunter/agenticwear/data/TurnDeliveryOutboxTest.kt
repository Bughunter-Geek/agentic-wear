package io.github.sirbughunter.agenticwear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TurnDeliveryOutboxTest {
    @Test
    fun `failed POST can retransmit exact durable ciphertext without a second UUID`() {
        var stored: PendingTurnDelivery? = null
        var encryptions = 0
        fun prepare() = prepareTurnDelivery(
            stored?.requestId, stored?.envelope, stored?.fingerprint, "same-prompt",
            createEnvelope = { encryptions++; "ciphertext-$it" },
            persist = { stored = it },
        )
        val first = prepare()
        // Simulate an ambiguous network exception after preparation, before ack.
        assertEquals(first, stored)
        val retry = prepare()
        assertEquals(first, retry)
        assertEquals(1, encryptions)
    }

    @Test
    fun `edited prompt cannot replace an unacknowledged delivery`() {
        val error = runCatching {
            prepareTurnDelivery("original-id", "original-ciphertext", "original", "edited",
                createEnvelope = { error("Must not encrypt another prompt") },
                persist = { error("Must not replace pending prompt") })
        }.exceptionOrNull()
        assertTrue(error?.message.orEmpty().contains("edited prompt has not been sent"))
    }

    @Test
    fun `persistence failure prevents a deliverable request from escaping`() {
        val error = runCatching {
            prepareTurnDelivery(null, null, null, "prompt", { "ciphertext" }, { error("Disk failed") })
        }.exceptionOrNull()
        assertEquals("Disk failed", error?.message)
    }
}
