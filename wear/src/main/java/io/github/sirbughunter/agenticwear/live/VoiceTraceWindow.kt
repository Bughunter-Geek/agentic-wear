package io.github.sirbughunter.agenticwear.live

import java.security.MessageDigest

internal enum class VoiceTraceStage {
    BEGIN, CAPABILITY_SEND, CAPABILITY_POSTED, CAPABILITY_RECEIVED, OFFER_BEGIN,
    ICE_GATHERING, ICE_CANDIDATE, CANDIDATE_ERROR, OFFER_READY, OFFER_NO_CANDIDATE,
    START_SEND, START_POSTED, ANSWER_RECEIVED, ANSWER_APPLIED, ANSWER_FAILED,
    ICE_STATE, PEER_STATE, CHANNEL_STATE, POLL_FAILED, STARTUP_FAILED, STARTUP_TIMEOUT, END,
    NETWORK_REQUEST, NETWORK_READY, OFFER_RETRY, ANSWER_DUPLICATE,
    PEER_CREATED, DEFAULT_ROUTE_OFFER,
}

/** Metadata only: no message, SDP, URL, address, caption or audio input is accepted. */
internal class VoiceTraceWindow(private val now: () -> Long, callId: String, threadId: String) {
    private val started = now()
    private val call = fingerprint(callId)
    private val thread = fingerprint(threadId)
    private var remaining = 80
    private val recorded = ArrayList<Map<String, Any>>()
    /** The bounded, metadata-only events of this call, for the bridge trace. */
    @Synchronized fun events(): List<Map<String, Any>> = recorded.toList()
    @Synchronized fun event(stage: VoiceTraceStage, state: String? = null, count: Int? = null): Map<String, Any>? {
        val elapsed = now() - started
        if (elapsed !in 0..90_000 || remaining <= 0) return null
        remaining--
        return buildMap {
            put("stage", stage.name); put("elapsedMs", elapsed); put("callHash", call); put("threadHash", thread)
            state?.takeIf { it in STATES }?.let { put("state", it) }
            count?.let { put("count", it.coerceIn(0, 65_536)) }
        }.also(recorded::add)
    }
    companion object {
        private val STATES = setOf("NEW", "GATHERING", "COMPLETE", "CHECKING", "CONNECTED", "COMPLETED",
            "CONNECTING", "DISCONNECTED", "FAILED", "CLOSED", "OPEN", "CLOSING", "TIMEOUT", "IO", "LINKAGE", "OTHER") +
            listOf("WIFI", "CELLULAR", "BLUETOOTH", "ETHERNET", "OTHER_NET", "NONE")
                .flatMap { listOf(it, "${it}_TIMEOUT", "${it}_UNREQUESTED") }
        private fun fingerprint(value: String) = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray()).take(6).joinToString("") { "%02x".format(it) }
    }
}
