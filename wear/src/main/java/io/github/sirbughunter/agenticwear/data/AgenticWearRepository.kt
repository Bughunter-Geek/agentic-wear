package io.github.sirbughunter.agenticwear.data

import android.content.Context
import android.content.Intent
import android.util.Base64
import io.github.sirbughunter.agenticwear.model.BridgePayload
import java.io.File
import java.util.UUID
import kotlinx.coroutines.delay
import org.json.JSONObject

class AgenticWearRepository(private val context: Context) {
    private val pairingStore = SecurePairingStore(context)
    private val preferences = AppPreferences(context)
    private val crypto = CryptoBox()
    private val relay = RelayApi()

    val isPaired: Boolean get() = pairingStore.read() != null

    suspend fun pair(code: String, relayUrl: String) {
        val normalizedUrl = RelayUrlPolicy.normalize(relayUrl)
        val authenticator = PairingAuthenticator.fromCode(code)
        val result = try {
            val fcmInstallationId = if (FirebaseProvider.configured) {
                FirebaseProvider.installationId(context)
            } else {
                null
            }
            relay.completePairing(
                relayUrl = normalizedUrl,
                authenticator = authenticator,
                watchPublicKey = crypto.publicKeyBase64(),
                fcmInstallationId = fcmInstallationId,
            )
        } finally {
            authenticator.clear()
        }
        pairingStore.write(
            Pairing(
                relayUrl = normalizedUrl,
                pairId = result.pairId,
                watchCredential = result.watchCredential,
                bridgePublicKey = result.bridgePublicKey,
            ),
        )
        preferences.relayUrl = normalizedUrl
    }

    suspend fun syncSessions() = send(BridgePayload.SessionSync(UUID.randomUUID().toString()))

    suspend fun transcribe(audioFile: File, threadId: String?): String {
        val requestId = UUID.randomUUID().toString()
        val bytes = audioFile.readBytes()
        try {
            require(bytes.size <= 512 * 1_024) { "Recording is too large; keep it under one minute" }
            preferences.pending = true
            preferences.transcript = null
            send(
                BridgePayload.CreateTranscription(
                    requestId = requestId,
                    audioBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
                    mimeType = "audio/mp4",
                    threadId = threadId,
                ),
            )
            check(audioFile.delete() || !audioFile.exists()) { "Could not remove the sent recording" }
            return requestId
        } catch (error: Throwable) {
            audioFile.delete()
            preferences.pending = false
            preferences.lastError = error.message
            throw error
        } finally {
            bytes.fill(0)
            broadcastStateChanged()
        }
    }

    suspend fun submitTurn(threadId: String?, text: String) {
        require(text.isNotBlank()) { "Transcript is empty" }
        preferences.pending = true
        send(BridgePayload.SubmitTurn(UUID.randomUUID().toString(), threadId, text.trim()))
        preferences.transcript = null
        broadcastStateChanged()
    }

    suspend fun respondToApproval(approvalId: String, approve: Boolean) {
        send(
            BridgePayload.ApprovalResponse(
                requestId = UUID.randomUUID().toString(),
                approvalId = approvalId,
                decision = if (approve) "accept" else "decline",
            ),
        )
    }

    suspend fun refreshInbox(notify: Boolean = true): Int {
        return refreshInboxBatch(notify).handled
    }

    suspend fun refreshInboxAndSessions(notify: Boolean = true) {
        refreshInboxBatch(notify)
        syncSessions()
        for (waitMillis in SESSION_REPLY_DELAYS_MS) {
            delay(waitMillis)
            if (refreshInboxBatch(notify).receivedSessionSnapshot) return
        }
    }

    private suspend fun refreshInboxBatch(notify: Boolean): InboxRefreshResult {
        val pairing = pairingStore.read() ?: return InboxRefreshResult(0, false)
        val envelopes = relay.fetchInbox(pairing)
        val acknowledged = mutableListOf<String>()
        var handled = 0
        var receivedSessionSnapshot = false
        envelopes.forEach { envelope ->
            val messageId = envelope.optString("messageId")
            runCatching { crypto.decrypt(pairing.pairId, pairing.bridgePublicKey, envelope) }
                .onSuccess { payload ->
                    processPayload(payload, notify)
                    if (payload.optString("kind") == "sessions.snapshot") receivedSessionSnapshot = true
                    if (messageId.isNotBlank()) acknowledged += messageId
                    handled += 1
                }
        }
        relay.acknowledge(pairing, acknowledged)
        if (handled > 0) broadcastStateChanged()
        return InboxRefreshResult(handled, receivedSessionSnapshot)
    }

    suspend fun updateFcmRegistration(installationId: String) {
        pairingStore.read()?.let { relay.updateFcmRegistration(it, installationId) }
    }

    fun disconnect() {
        pairingStore.clear()
        crypto.clearPairingKey()
        preferences.sessions = emptyList()
        preferences.latestAlert = null
        preferences.transcript = null
        preferences.pending = false
        preferences.lastError = null
        broadcastStateChanged()
    }

    private suspend fun send(payload: BridgePayload) {
        val pairing = pairingStore.read() ?: error("Pair Agentic Wear first")
        val plaintext = PayloadCodec.encode(payload)
        relay.sendToBridge(pairing, crypto.encrypt(pairing.pairId, pairing.bridgePublicKey, plaintext))
    }

    private fun processPayload(payload: JSONObject, notify: Boolean) {
        when (payload.optString("kind")) {
            "sessions.snapshot" -> {
                preferences.sessions = PayloadCodec.decodeSessions(payload)
                preferences.lastError = null
            }
            "transcription.ready" -> {
                preferences.transcript = PayloadCodec.decodeTranscript(payload)
                preferences.pending = false
                preferences.lastError = null
            }
            "terminal.completed", "terminal.failed", "terminal.interrupted", "terminal.blocked",
            "approval.request" -> PayloadCodec.decodeAlert(payload)?.let { alert ->
                preferences.latestAlert = alert
                preferences.pending = false
                if (notify && preferences.markEventHandled(alert.eventId)) {
                    io.github.sirbughunter.agenticwear.notification.AgentNotifier.post(context, alert)
                }
            }
            "transcription.error", "turn.error", "approval.error", "bridge.error" -> {
                preferences.pending = false
                preferences.lastError = payload.optString("message", "The request could not be completed")
            }
            "turn.accepted", "approval.accepted" -> {
                preferences.pending = false
                preferences.lastError = null
            }
        }
    }

    private fun broadcastStateChanged() {
        context.sendBroadcast(Intent(ACTION_STATE_CHANGED).setPackage(context.packageName))
    }

    companion object {
        const val ACTION_STATE_CHANGED = "io.github.sirbughunter.agenticwear.STATE_CHANGED"
        private val SESSION_REPLY_DELAYS_MS = longArrayOf(150, 300, 600, 1_200)
    }
}

private data class InboxRefreshResult(
    val handled: Int,
    val receivedSessionSnapshot: Boolean,
)
