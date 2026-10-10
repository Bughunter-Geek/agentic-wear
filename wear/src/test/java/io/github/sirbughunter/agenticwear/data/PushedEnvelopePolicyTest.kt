package io.github.sirbughunter.agenticwear.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PushedEnvelopePolicyTest {
    private val now = 1_800_000_000_000L

    private fun ok(
        length: Int = 1_000,
        sender: String? = "bridge",
        recipient: String? = "watch",
        id: String? = "m1",
        sentAt: Long = now,
    ) = pushedEnvelopeAcceptable(length, sender, recipient, id, sentAt, now)

    @Test fun `a well formed recent bridge to watch envelope is accepted`() {
        assertTrue(ok())
        assertTrue(ok(length = 3_000))
    }

    @Test fun `wrong direction is rejected`() {
        assertFalse(ok(sender = "watch"))
        assertFalse(ok(recipient = "bridge"))
        assertFalse(ok(sender = null))
        assertFalse(ok(recipient = null))
    }

    @Test fun `blank message id is rejected`() {
        assertFalse(ok(id = null))
        assertFalse(ok(id = ""))
        assertFalse(ok(id = "  "))
    }

    @Test fun `too long is rejected`() {
        assertFalse(ok(length = 3_001))
    }

    @Test fun `stale or far future envelopes are rejected`() {
        assertTrue(ok(sentAt = now - 10 * 60 * 1_000L))
        assertFalse(ok(sentAt = now - 10 * 60 * 1_000L - 1))
        assertTrue(ok(sentAt = now + 10 * 60 * 1_000L))
        assertFalse(ok(sentAt = now + 10 * 60 * 1_000L + 1))
        assertFalse(ok(sentAt = 0L))
    }
}
