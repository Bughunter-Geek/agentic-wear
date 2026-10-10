package io.github.sirbughunter.agenticwear.live

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout

/** This bridge carries one complete SDP, with no trickle-candidate messages. */
internal class CompleteVoiceOffer {
    private val gathering = CompletableDeferred<Unit>()
    fun gathered() { gathering.complete(Unit) }
    fun close() { gathering.cancel() }
    suspend fun await(read: () -> String, timeoutMs: Long = 5_000): String {
        withTimeout(timeoutMs) { gathering.await() }
        return read().also { sdp ->
            if (sdp.lineSequence().none { it.startsWith("a=candidate:") }) throw NoVoiceCandidateException()
        }
    }
}
