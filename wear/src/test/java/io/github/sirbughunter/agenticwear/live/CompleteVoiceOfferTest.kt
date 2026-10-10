package io.github.sirbughunter.agenticwear.live

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class CompleteVoiceOfferTest {
    private val sdp = "v=0\r\na=candidate:host 1 udp 1 192.0.2.1 9000 typ host\r\n"
    @Test fun readsOfferOnlyAfterGatheringCompletes() = runBlocking {
        val offer = CompleteVoiceOffer(); var read = false
        val result = async { offer.await({ read = true; sdp }) }
        yield(); assertFalse(read); offer.gathered(); assertEquals(sdp, result.await())
    }
    @Test fun alreadyCompleteDoesNotLoseNotification() = runBlocking {
        val offer = CompleteVoiceOffer(); offer.gathered(); assertEquals(sdp, offer.await({ sdp }))
    }
    @Test fun missingCandidatesAreRejectedInsteadOfSent() = runBlocking {
        val offer = CompleteVoiceOffer(); offer.gathered()
        try { offer.await({ "v=0\r\n" }); fail() } catch (_: IllegalStateException) {}
    }
    @Test fun timeoutAndCloseCannotReadOrDispatchIncompleteOffer() = runBlocking {
        val offer = CompleteVoiceOffer()
        try { offer.await({ fail(); sdp }, 10); fail() } catch (_: TimeoutCancellationException) {}
        offer.close()
        try { offer.await({ fail(); sdp }); fail() } catch (_: CancellationException) {}
    }
    @Test fun repeatedConnectEndReconnectUsesFreshGatheringState() = runBlocking {
        repeat(100) {
            val offer = CompleteVoiceOffer()
            var reads = 0
            val result = async { offer.await({ reads++; sdp }) }
            yield(); assertEquals(0, reads)
            offer.gathered(); assertEquals(sdp, result.await())
            offer.close(); assertEquals(1, reads)
        }
    }
    @Test fun lateCompletionFromClosedPeerCannotReleaseNextPeer() = runBlocking {
        val old = CompleteVoiceOffer(); old.close()
        val next = CompleteVoiceOffer(); var read = false
        val result = async { next.await({ read = true; sdp }) }
        yield(); old.gathered(); yield(); assertFalse(read)
        next.gathered(); assertEquals(sdp, result.await())
    }
    @Test fun closeCancelsPendingGatheringWithoutReadingSdp() = runBlocking {
        val offer = CompleteVoiceOffer(); var read = false
        val result = async { offer.await({ read = true; sdp }) }
        yield(); offer.close()
        try { result.await(); fail() } catch (_: CancellationException) {}
        offer.gathered(); assertFalse(read)
    }
    @Test fun failedCandidateOfferDoesNotPoisonNextConnection() = runBlocking {
        val failed = CompleteVoiceOffer(); failed.gathered()
        try { failed.await({ "v=0\r\n" }); fail() } catch (_: IllegalStateException) {}
        failed.close()
        val next = CompleteVoiceOffer(); next.gathered()
        assertEquals(sdp, next.await({ sdp }))
    }
}
