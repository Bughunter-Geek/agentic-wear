package io.github.sirbughunter.agenticwear.data

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class RelayFailureLogTest {
    @Before
    fun emptyLog() = RelayFailureLog.resetForTest()

    @After
    fun leaveLogEmpty() = RelayFailureLog.resetForTest()

    @Test
    fun `entries are kept in the order they were recorded`() {
        RelayFailureLog.record("fetchInbox", 503, "RelayException", 10L)
        RelayFailureLog.record("sendToBridge", 0, "SocketTimeoutException", 20L)

        assertEquals(
            listOf(
                RelayFailure("fetchInbox", 503, "RelayException", 10L),
                RelayFailure("sendToBridge", 0, "SocketTimeoutException", 20L),
            ),
            RelayFailureLog.snapshot(),
        )
    }

    @Test
    fun `an empty log has an empty snapshot`() {
        assertTrue(RelayFailureLog.snapshot().isEmpty())
    }

    @Test
    fun `only the newest twenty entries survive`() {
        repeat(25) { RelayFailureLog.record("fetchInbox", 500 + it, "RelayException", it.toLong()) }

        val snapshot = RelayFailureLog.snapshot()
        assertEquals(20, snapshot.size)
        assertEquals(RelayFailureLog.MAX_ENTRIES, snapshot.size)
        assertEquals((5L..24L).toList(), snapshot.map { it.at })
        assertEquals(505, snapshot.first().status)
        assertEquals(524, snapshot.last().status)
    }

    @Test
    fun `the snapshot is an independent copy`() {
        RelayFailureLog.record("fetchInbox", 503, "RelayException", 1L)
        val first = RelayFailureLog.snapshot()
        RelayFailureLog.record("fetchInbox", 502, "RelayException", 2L)

        assertEquals(1, first.size)
        assertEquals(2, RelayFailureLog.snapshot().size)
    }

    @Test
    fun `clear removes exactly the given entries and keeps later ones`() {
        RelayFailureLog.record("fetchInbox", 503, "RelayException", 1L)
        RelayFailureLog.record("acknowledge", 0, "IOException", 2L)
        val reported = RelayFailureLog.snapshot()
        RelayFailureLog.record("sendToBridge", 0, "SocketTimeoutException", 3L)

        RelayFailureLog.clear(reported)

        assertEquals(listOf(RelayFailure("sendToBridge", 0, "SocketTimeoutException", 3L)), RelayFailureLog.snapshot())
    }

    @Test
    fun `clear leaves entries that were not listed`() {
        RelayFailureLog.record("fetchInbox", 503, "RelayException", 1L)
        RelayFailureLog.record("fetchInbox", 503, "RelayException", 2L)
        RelayFailureLog.record("pairing", 400, "RelayException", 3L)

        RelayFailureLog.clear(listOf(RelayFailure("fetchInbox", 503, "RelayException", 2L)))

        assertEquals(
            listOf(RelayFailure("fetchInbox", 503, "RelayException", 1L), RelayFailure("pairing", 400, "RelayException", 3L)),
            RelayFailureLog.snapshot(),
        )
    }

    @Test
    fun `clear removes one stored entry per listed entry when entries are identical`() {
        repeat(3) { RelayFailureLog.record("fetchInbox", 503, "RelayException", 7L) }
        val same = RelayFailure("fetchInbox", 503, "RelayException", 7L)

        RelayFailureLog.clear(listOf(same, same))

        assertEquals(listOf(same), RelayFailureLog.snapshot())
    }

    @Test
    fun `clearing nothing or entries that are gone changes nothing`() {
        RelayFailureLog.record("fetchInbox", 503, "RelayException", 1L)

        RelayFailureLog.clear(emptyList())
        RelayFailureLog.clear(listOf(RelayFailure("acknowledge", 404, "RelayException", 99L)))

        assertEquals(1, RelayFailureLog.snapshot().size)
    }

    @Test
    fun `clearing a snapshot after the log has rolled over only drops entries that still exist`() {
        repeat(20) { RelayFailureLog.record("fetchInbox", 503, "RelayException", it.toLong()) }
        val reported = RelayFailureLog.snapshot()
        repeat(5) { RelayFailureLog.record("fetchInbox", 502, "RelayException", 100L + it) }

        RelayFailureLog.clear(reported)

        assertEquals((100L..104L).toList(), RelayFailureLog.snapshot().map { it.at })
    }

    @Test
    fun `concurrent recording stays bounded and loses no newest entries`() {
        val threads = 8
        val perThread = 200
        val pool = Executors.newFixedThreadPool(threads)
        val start = CountDownLatch(1)
        val done = CountDownLatch(threads)
        repeat(threads) { thread ->
            pool.execute {
                start.await()
                repeat(perThread) { RelayFailureLog.record("fetchInbox", 503, "RelayException", (thread * perThread + it).toLong()) }
                done.countDown()
            }
        }
        start.countDown()
        assertTrue(done.await(10, TimeUnit.SECONDS))
        pool.shutdownNow()

        val snapshot = RelayFailureLog.snapshot()
        assertEquals(RelayFailureLog.MAX_ENTRIES, snapshot.size)
        assertEquals(snapshot.size, snapshot.map { it.at }.distinct().size)
    }
}
