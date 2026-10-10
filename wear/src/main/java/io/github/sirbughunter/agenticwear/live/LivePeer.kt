package io.github.sirbughunter.agenticwear.live

import kotlinx.coroutines.delay

interface LivePeer {
    suspend fun offer(): String
    suspend fun answer(sdp: String)
    fun mute(muted: Boolean)
    fun levels(callback: (Float, Float) -> Unit)
    fun close()
}

/** ICE gathering completed with no candidate at all; a fresh peer has been seen to succeed. */
class NoVoiceCandidateException : IllegalStateException(
    "No voice network candidate was found. Check the watch connection and retry this task.")

/**
 * Creates the offer, retrying with a fresh peer only when gathering found no candidate.
 * Any other failure or cancellation closes the peer and propagates unchanged.
 */
internal suspend fun offerWithFreshPeers(
    create: () -> LivePeer,
    offer: suspend (LivePeer) -> String,
    retrying: (attempt: Int) -> Unit = {},
    attempts: Int = 3,
    wait: suspend (Long) -> Unit = { delay(it) },
): Pair<LivePeer, String> {
    var attempt = 1
    while (true) {
        val peer = create()
        try {
            return peer to offer(peer)
        } catch (error: NoVoiceCandidateException) {
            runCatching { peer.close() }
            if (attempt >= attempts) throw error
            retrying(attempt)
            wait(150L * attempt)
            attempt++
        } catch (error: Throwable) {
            runCatching { peer.close() }
            throw error
        }
    }
}

/** Mute can be chosen while capability negotiation is still creating the peer. */
internal suspend fun LivePeer.offerWithMuteState(muted: Boolean): String {
    mute(muted)
    return offer()
}
