package io.github.sirbughunter.agenticwear.data

import java.io.IOException
import java.net.SocketException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RelayApiRetryPolicyTest {
    @Test
    fun `connection abort is retried with bounded backoff`() {
        val error = SocketException("Software caused connection abort")

        assertEquals(250L, relayRetryDelayMillis(error, 0))
        assertEquals(750L, relayRetryDelayMillis(error, 1))
        assertNull(relayRetryDelayMillis(error, 2))
    }

    @Test
    fun `other transport IO failures use the same bounded policy`() {
        assertEquals(250L, relayRetryDelayMillis(IOException("connection reset"), 0))
        assertNull(relayRetryDelayMillis(IllegalStateException("bad response"), 0))
        assertNull(relayRetryDelayMillis(IOException("connection reset"), -1))
    }
}
