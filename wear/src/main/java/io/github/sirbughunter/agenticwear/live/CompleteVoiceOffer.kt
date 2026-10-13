package io.github.sirbughunter.agenticwear.live

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout

/** This bridge carries one gathered SDP, with no trickle-candidate messages. */
internal class CompleteVoiceOffer {
    private val gathering = CompletableDeferred<Unit>()
    fun gathered() { gathering.complete(Unit) }
    fun close() { gathering.cancel() }
    suspend fun await(read: () -> String, timeoutMs: Long = 5_000, allowWithoutCandidates: Boolean = false): String {
        withTimeout(timeoutMs) { gathering.await() }
        return read().also { sdp ->
            if (sdp.lineSequence().none { it.startsWith("a=candidate:") }) {
                // Wildcard ports can pair with candidates from the answer even
                // without an advertised local address. Native Dot already uses
                // such offers. Ordinary calls retain the candidate requirement.
                val lines = sdp.lineSequence().toList()
                val nativeOffer = lines.firstOrNull() == "v=0" &&
                    listOf("m=audio ", "m=application ", "a=ice-ufrag:", "a=ice-pwd:", "a=fingerprint:")
                        .all { prefix -> lines.any { it.startsWith(prefix) && it.length > prefix.length } }
                if (!allowWithoutCandidates || !nativeOffer) throw NoVoiceCandidateException()
            }
        }
    }
}
