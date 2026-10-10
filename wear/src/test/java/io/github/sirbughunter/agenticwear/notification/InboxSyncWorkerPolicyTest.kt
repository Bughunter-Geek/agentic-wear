package io.github.sirbughunter.agenticwear.notification

import io.github.sirbughunter.agenticwear.data.RelayException
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test

class InboxSyncWorkerPolicyTest {
    @Test
    fun `transport failures retry after 1, 2 and 4 seconds`() {
        val error = IOException("connection reset")

        assertEquals(1_000L, pushFetchRetryDelayMs(0, error))
        assertEquals(2_000L, pushFetchRetryDelayMs(1, error))
        assertEquals(4_000L, pushFetchRetryDelayMs(2, error))
    }

    @Test
    fun `subclasses of IOException are transport failures too`() {
        assertEquals(1_000L, pushFetchRetryDelayMs(0, SocketTimeoutException("timeout")))
        assertEquals(1_000L, pushFetchRetryDelayMs(0, UnknownHostException("relay")))
    }

    @Test
    fun `a server error retries`() {
        assertEquals(1_000L, pushFetchRetryDelayMs(0, RelayException(503, "Relay request failed")))
        assertEquals(2_000L, pushFetchRetryDelayMs(1, RelayException(500, "Relay request failed")))
        assertEquals(4_000L, pushFetchRetryDelayMs(2, RelayException(599, "Relay request failed")))
    }

    @Test
    fun `a relay failure without an HTTP status retries`() {
        assertEquals(1_000L, pushFetchRetryDelayMs(0, RelayException(0, "Relay request failed")))
    }

    @Test
    fun `a client error never retries`() {
        for (status in listOf(400, 401, 403, 404, 408, 409, 429, 499)) {
            for (attemptIndex in 0..3) {
                assertNull("status $status attempt $attemptIndex", pushFetchRetryDelayMs(attemptIndex, RelayException(status, "x")))
            }
        }
    }

    @Test
    fun `redirects and other non-error statuses do not retry`() {
        assertNull(pushFetchRetryDelayMs(0, RelayException(302, "x")))
        assertNull(pushFetchRetryDelayMs(0, RelayException(-1, "x")))
    }

    @Test
    fun `the retry budget is exhausted after four attempts`() {
        assertEquals(4, PUSH_FETCH_MAX_ATTEMPTS)
        assertNull(pushFetchRetryDelayMs(3, IOException("still down")))
        assertNull(pushFetchRetryDelayMs(3, RelayException(503, "x")))
        assertNull(pushFetchRetryDelayMs(4, IOException("still down")))
        assertNull(pushFetchRetryDelayMs(100, IOException("still down")))
        assertNull(pushFetchRetryDelayMs(-1, IOException("negative index")))
    }

    @Test
    fun `other exceptions are not connectivity problems and do not retry`() {
        assertNull(pushFetchRetryDelayMs(0, IllegalStateException("bad state")))
        assertNull(pushFetchRetryDelayMs(0, IllegalArgumentException("bad argument")))
        assertNull(pushFetchRetryDelayMs(0, CancellationException("cancelled")))
    }

    @Test
    fun `the loop returns the first success and numbers attempts from one`() = runBlocking {
        val attempts = mutableListOf<Int>()
        val waits = mutableListOf<Long>()

        val result = retryPushFetch(wait = { waits += it }) { attempt ->
            attempts += attempt
            if (attempt < 3) throw RelayException(503, "Relay request failed")
            "ok on $attempt"
        }

        assertEquals("ok on 3", result)
        assertEquals(listOf(1, 2, 3), attempts)
        assertEquals(listOf(1_000L, 2_000L), waits)
    }

    @Test
    fun `the loop makes one attempt when it succeeds at once`() = runBlocking {
        val waits = mutableListOf<Long>()
        var calls = 0

        retryPushFetch(wait = { waits += it }) { calls += 1 }

        assertEquals(1, calls)
        assertEquals(emptyList<Long>(), waits)
    }

    @Test
    fun `the loop gives up after four attempts and rethrows the last failure`() = runBlocking {
        val attempts = mutableListOf<Int>()
        val waits = mutableListOf<Long>()

        try {
            retryPushFetch<Unit>(wait = { waits += it }) { attempt ->
                attempts += attempt
                throw IOException("down $attempt")
            }
            fail("expected the last IOException")
        } catch (error: IOException) {
            assertEquals("down 4", error.message)
        }

        assertEquals(listOf(1, 2, 3, 4), attempts)
        assertEquals(listOf(1_000L, 2_000L, 4_000L), waits)
    }

    @Test
    fun `the loop does not retry a client error`() = runBlocking {
        val waits = mutableListOf<Long>()
        var calls = 0

        try {
            retryPushFetch<Unit>(wait = { waits += it }) {
                calls += 1
                throw RelayException(404, "Relay request failed")
            }
            fail("expected a RelayException")
        } catch (error: RelayException) {
            assertEquals(404, error.status)
        }

        assertEquals(1, calls)
        assertEquals(emptyList<Long>(), waits)
    }

    @Test
    fun `the loop does not retry cancellation`() = runBlocking {
        var calls = 0

        try {
            retryPushFetch<Unit>(wait = { fail("must not wait") }) {
                calls += 1
                throw CancellationException("worker stopped")
            }
            fail("expected a CancellationException")
        } catch (_: CancellationException) {
        }

        assertEquals(1, calls)
    }

    @Test
    fun `the loop stops on the first failure the policy refuses and keeps its type`() = runBlocking {
        var calls = 0
        val waits = mutableListOf<Long>()
        try {
            retryPushFetch<Unit>(wait = { waits += it }) {
                calls += 1
                if (calls == 1) throw IOException("blip")
                throw RelayException(401, "Relay request failed")
            }
            fail("expected a RelayException")
        } catch (error: RelayException) {
            assertEquals(401, error.status)
        }
        assertEquals(2, calls)
        assertEquals(listOf(1_000L), waits)
    }
}
