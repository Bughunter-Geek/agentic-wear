package io.github.sirbughunter.agenticwear.live

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LivePeerMuteTest {
    @Test fun muteChosenBeforePeerExistsAppliesBeforeNegotiation() = runBlocking {
        val peer = FakePeer()
        assertEquals("offer", peer.offerWithMuteState(muted = true))
        assertEquals(listOf("mute:true", "offer:true"), peer.events)
        assertTrue(peer.muted)
    }

    @Test fun unmutedStartAppliesTheCurrentChoice() = runBlocking {
        val peer = FakePeer(initiallyMuted = true)
        peer.offerWithMuteState(muted = false)
        assertEquals(listOf("mute:false", "offer:false"), peer.events)
        assertFalse(peer.muted)
    }

    @Test fun muteChangedDuringOfferIsNotResetWhenNegotiationFinishes() = runBlocking {
        val finishOffer = CompletableDeferred<Unit>()
        val peer = FakePeer(finishOffer = finishOffer)
        val offer = async { peer.offerWithMuteState(muted = false) }
        peer.offerStarted.await()
        peer.mute(true)
        finishOffer.complete(Unit)
        assertEquals("offer", offer.await())
        assertTrue(peer.muted)
        assertEquals(listOf("mute:false", "offer:false", "mute:true"), peer.events)
    }

    private class FakePeer(
        initiallyMuted: Boolean = false,
        private val finishOffer: CompletableDeferred<Unit>? = null,
    ) : LivePeer {
        var muted = initiallyMuted
            private set
        val events = mutableListOf<String>()
        val offerStarted = CompletableDeferred<Unit>()

        override fun mute(muted: Boolean) {
            this.muted = muted
            events += "mute:$muted"
        }

        override suspend fun offer(): String {
            events += "offer:$muted"
            offerStarted.complete(Unit)
            finishOffer?.await()
            return "offer"
        }

        override suspend fun answer(sdp: String) = Unit
        override fun levels(callback: (Float, Float) -> Unit) = Unit
        override fun close() = Unit
    }
}
