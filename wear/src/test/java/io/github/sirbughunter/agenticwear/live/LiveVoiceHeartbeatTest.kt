package io.github.sirbughunter.agenticwear.live

import io.github.sirbughunter.agenticwear.data.RelayException
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.advanceTimeBy
import org.junit.Assert.*
import org.junit.Test

class LiveVoiceHeartbeatTest {
    private class Clock { var time = 0L; var active = true; var lost = 0; val sends = mutableListOf<Long>() }
    private suspend fun run(clock: Clock, wait: suspend (Long) -> Unit = { clock.time += it }, action: () -> Unit) =
        maintainLiveHeartbeat({ clock.time }, wait, { clock.active }, {
            clock.sends += clock.time; action()
        }, { clock.lost++; clock.active = false })

    @Test fun oneNetworkMissRetriesAndReturnsToTheNormalCadence() = runBlocking {
        val c = Clock()
        run(c) {
            if (c.sends.size == 1) throw IOException("Temporary loss")
            if (c.sends.size == 3) c.active = false
        }
        assertEquals(listOf(10_000L, 12_000L, 22_000L), c.sends)
        assertEquals(0, c.lost)
    }
    @Test fun sustainedLossEndsOnceBeforeTheBridgeLeaseExpires() = runBlocking {
        val c = Clock(); run(c) { throw IOException("Offline") }
        assertEquals(30_000L, c.time); assertEquals(1, c.lost)
        assertEquals(10, c.sends.size); assertTrue(c.sends.all { it < 30_000 })
    }
    @Test fun aRecoveredHeartbeatResetsTheFailureBudget() = runBlocking {
        val c = Clock()
        run(c) { if (c.sends.size != 2) throw IOException("Offline") }
        assertEquals(42_000L, c.time); assertEquals(1, c.lost)
    }
    @Test fun authenticationRejectionDoesNotEnterARetryLoop() = runBlocking {
        val c = Clock(); run(c) { throw RelayException(401, "Rejected") }
        assertEquals(listOf(10_000L), c.sends); assertEquals(1, c.lost)
    }
    @Test fun temporaryServerFailureCanRecoverWithoutEndingMedia() = runBlocking {
        val c = Clock()
        run(c) { if (c.sends.size == 1) throw RelayException(503, "Unavailable") else c.active = false }
        assertEquals(listOf(10_000L, 12_000L), c.sends); assertEquals(0, c.lost)
    }
    @Test fun cancellationPropagatesWithoutReportingAConnectionFailure() = runBlocking {
        val c = Clock()
        try { run(c) { throw CancellationException("Ended") }; fail() }
        catch (_: CancellationException) { assertEquals(0, c.lost) }
    }
    @Test fun endingDuringBackoffCannotSendAStaleHeartbeat() = runBlocking {
        val c = Clock()
        run(c, wait = { c.time += it; if (c.sends.isNotEmpty()) c.active = false }) { throw IOException("Offline") }
        assertEquals(listOf(10_000L), c.sends); assertEquals(0, c.lost)
    }
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun firstConnectionSettlesStartupPermanentlyAcrossLaterReconnection() = runTest {
        val connected = CompletableDeferred<Unit>()
        launch { delay(6_000); connected.complete(Unit) }
        assertTrue(awaitLiveMediaStart(connected))
        assertEquals(6_000L, currentTime)
        // A later transient phase cannot undo the first connection fact.
        advanceTimeBy(40_000)
        assertTrue(awaitLiveMediaStart(connected))
        assertEquals(46_000L, currentTime)
    }
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test fun noFirstConnectionStillTimesOutAtTheExistingLimit() = runTest {
        assertFalse(awaitLiveMediaStart(CompletableDeferred<Unit>()))
        assertEquals(30_000L, currentTime)
    }
}
