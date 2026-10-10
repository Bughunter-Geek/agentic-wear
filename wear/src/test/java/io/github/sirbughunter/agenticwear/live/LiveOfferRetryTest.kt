package io.github.sirbughunter.agenticwear.live

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class LiveOfferRetryTest {
    private class Peer(val id: Int) : LivePeer {
        var closed = false
        override suspend fun offer() = "offer-$id"
        override suspend fun answer(sdp: String) = Unit
        override fun mute(muted: Boolean) = Unit
        override fun levels(callback: (Float, Float) -> Unit) = Unit
        override fun close() { closed = true }
    }

    @Test fun emptyGatheringRetriesWithAFreshPeerAndClosesTheFailedOne() = runBlocking {
        val peers = mutableListOf<Peer>(); val retries = mutableListOf<Int>(); val waits = mutableListOf<Long>()
        val (peer, offer) = offerWithFreshPeers(
            create = { Peer(peers.size + 1).also(peers::add) },
            offer = { if ((it as Peer).id < 3) throw NoVoiceCandidateException() else it.offer() },
            retrying = retries::add, wait = { waits += it },
        )
        assertEquals("offer-3", offer); assertSame(peers[2], peer)
        assertEquals(listOf(true, true, false), peers.map { it.closed })
        assertEquals(listOf(1, 2), retries); assertEquals(listOf(150L, 300L), waits)
    }

    @Test fun givesUpAfterTheLastAttemptWithTheSameMessage() = runBlocking {
        val peers = mutableListOf<Peer>()
        val error = runCatching {
            offerWithFreshPeers(create = { Peer(peers.size).also(peers::add) },
                offer = { throw NoVoiceCandidateException() }, wait = {})
        }.exceptionOrNull()
        assertTrue(error is NoVoiceCandidateException)
        assertTrue(error!!.message!!.startsWith("No voice network candidate was found"))
        assertEquals(3, peers.size); assertTrue(peers.all { it.closed })
    }

    @Test fun otherFailuresAndCancellationAreNeverRetried() = runBlocking {
        for (failure in listOf(IllegalStateException("Voice negotiation failed"), CancellationException("ended"))) {
            val peers = mutableListOf<Peer>()
            val error = runCatching {
                offerWithFreshPeers(create = { Peer(peers.size).also(peers::add) }, offer = { throw failure }, wait = { fail() })
            }.exceptionOrNull()
            assertSame(failure, error); assertEquals(1, peers.size); assertTrue(peers.single().closed)
        }
    }
}
