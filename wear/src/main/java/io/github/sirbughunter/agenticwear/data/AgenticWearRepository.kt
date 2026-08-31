package io.github.sirbughunter.agenticwear.data

import android.content.Context
import android.content.Intent
import android.util.Base64
import io.github.sirbughunter.agenticwear.model.BridgePayload
import io.github.sirbughunter.agenticwear.model.ChatSnapshot
import io.github.sirbughunter.agenticwear.model.FeedbackRating
import io.github.sirbughunter.agenticwear.model.FollowUpAction
import io.github.sirbughunter.agenticwear.notification.AgentNotifier
import io.github.sirbughunter.agenticwear.notification.shouldPostAlertNotification
import java.io.File
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

class AgenticWearRepository(private val context: Context) {
    private var pendingChatRefreshStartedAtMillis = 0L
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

    suspend fun transcribe(
        audioFile: File,
        threadId: String?,
        requestId: String,
        notifyAfterMillis: Long? = null,
    ): String {
        val revisionBase = preferences.revisionBase
        val bytes = audioFile.readBytes()
        try {
            if (preferences.isTranscriptionCancelled(requestId)) {
                throw kotlinx.coroutines.CancellationException("Transcription was cancelled")
            }
            require(bytes.size <= MAX_RECORDING_BYTES) { "Recording is too large; keep it under four minutes" }
            preferences.pending = true
            preferences.pendingTranscriptionRequestId = requestId
            preferences.transcript = null
            preferences.lastError = null
            send(
                BridgePayload.CreateTranscription(
                    requestId = requestId,
                    audioBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
                    mimeType = "audio/aac",
                    threadId = threadId,
                    previousText = revisionBase?.text,
                ),
            )
            check(audioFile.delete() || !audioFile.exists()) { "Could not remove the sent recording" }
            for (waitMillis in transcriptionReplyDelaysMs()) {
                delay(waitMillis)
                refreshInboxBatch(notify = true, notifyAfterMillis = notifyAfterMillis)
                if (preferences.transcript?.requestId == requestId || preferences.lastError != null) break
            }
            return requestId
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            audioFile.delete()
            if (preferences.pendingTranscriptionRequestId == requestId) {
                preferences.pendingTranscriptionRequestId = null
                preferences.pending = false
            }
            throw cancelled
        } catch (error: Throwable) {
            audioFile.delete()
            revisionBase?.let { preferences.transcript = it }
            preferences.revisionBase = null
            preferences.pendingTranscriptionRequestId = null
            preferences.pending = false
            preferences.lastError = error.message
            throw error
        } finally {
            bytes.fill(0)
            broadcastStateChanged()
        }
    }

    fun cancelTranscription(requestId: String? = preferences.pendingTranscriptionRequestId) {
        requestId?.let(preferences::markTranscriptionCancelled)
        preferences.pendingTranscriptionRequestId = null
        preferences.revisionBase?.let { preferences.transcript = it }
        preferences.revisionBase = null
        preferences.pending = false
        preferences.lastError = null
        broadcastStateChanged()
    }

    suspend fun submitTurn(
        threadId: String?,
        text: String,
        model: String?,
        effort: String,
        followUpAction: FollowUpAction = FollowUpAction.DEFAULT,
    ): String {
        require(text.isNotBlank()) { "Transcript is empty" }
        val requestId = UUID.randomUUID().toString()
        preferences.pending = true
        preferences.pendingTurnRequestId = requestId
        preferences.lastAcceptedThreadId = null
        preferences.lastAcceptedTurnRequestId = null
        preferences.lastSendNotice = null
        preferences.lastError = null
        try {
            send(
                BridgePayload.SubmitTurn(
                    requestId = requestId,
                    threadId = threadId,
                    text = text.trim(),
                    model = model,
                    effort = effort,
                    followUpAction = followUpAction,
                ),
            )
            for (waitMillis in TURN_REPLY_DELAYS_MS) {
                delay(waitMillis)
                refreshInboxBatch(notify = true)
                if (preferences.pendingTurnRequestId != requestId) break
            }
            if (preferences.pendingTurnRequestId == requestId) {
                preferences.pendingTurnRequestId = null
                preferences.pending = false
                val message = "The relay delivered your prompt, but Codex did not acknowledge it within 15 seconds. Keep the private bridge and Codex running, then retry."
                preferences.lastError = message
                error(message)
            }
            preferences.lastError?.let(::error)
            return preferences.lastAcceptedThreadId
                ?: error("Codex accepted the request without returning a session. Refresh Sessions and retry.")
        } catch (error: Throwable) {
            if (preferences.pendingTurnRequestId == requestId) preferences.pendingTurnRequestId = null
            preferences.pending = false
            if (preferences.lastError == null) preferences.lastError = error.message
            throw error
        } finally {
            broadcastStateChanged()
        }
    }

    suspend fun watchChat(threadId: String): ChatSnapshot? {
        require(threadId.isNotBlank()) { "Choose a Codex session first" }
        val requestId = UUID.randomUUID().toString()
        preferences.pendingChatRequestId = requestId
        preferences.lastError = null
        send(BridgePayload.WatchChat(requestId, threadId))
        for (waitMillis in CHAT_REPLY_DELAYS_MS) {
            delay(waitMillis)
            refreshInboxBatch(notify = true)
            preferences.chatSnapshot
                ?.takeIf { it.threadId == threadId && it.requestId == requestId }
                ?.let { return it }
            if (preferences.lastError != null) break
        }
        val snapshot = preferences.chatSnapshot?.takeIf { it.threadId == threadId && it.requestId == requestId }
        if (preferences.pendingChatRequestId == requestId) preferences.pendingChatRequestId = null
        return snapshot
    }

    suspend fun refreshChatInbox() {
        refreshInboxBatch(notify = true)
    }

    suspend fun requestChatRefresh(threadId: String) {
        require(threadId.isNotBlank()) { "Choose a Codex session first" }
        val now = System.currentTimeMillis()
        if (
            preferences.pendingChatRequestId != null &&
            pendingChatRefreshStartedAtMillis > 0L &&
            now - pendingChatRefreshStartedAtMillis < CHAT_REFRESH_REQUEST_TIMEOUT_MS
        ) return
        val requestId = UUID.randomUUID().toString()
        preferences.pendingChatRequestId = requestId
        pendingChatRefreshStartedAtMillis = now
        send(BridgePayload.WatchChat(requestId, threadId))
    }

    suspend fun unwatchChat(threadId: String) {
        send(BridgePayload.UnwatchChat(UUID.randomUUID().toString(), threadId))
    }

    suspend fun respondToApproval(approvalId: String, approve: Boolean) {
        val requestId = UUID.randomUUID().toString()
        preferences.pending = true
        preferences.pendingApprovalRequestId = requestId
        preferences.lastError = null
        try {
            send(
                BridgePayload.ApprovalResponse(
                    requestId = requestId,
                    approvalId = approvalId,
                    decision = if (approve) "accept" else "decline",
                ),
            )
            for (waitMillis in APPROVAL_REPLY_DELAYS_MS) {
                delay(waitMillis)
                refreshInboxBatch(notify = true)
                if (preferences.pendingApprovalRequestId != requestId) break
            }
            if (preferences.pendingApprovalRequestId == requestId) {
                preferences.pendingApprovalRequestId = null
                preferences.pending = false
                error("Codex did not acknowledge the permission decision. Keep the private bridge running, then retry.")
            }
            preferences.lastError?.let(::error)
        } catch (error: Throwable) {
            if (preferences.pendingApprovalRequestId == requestId) {
                preferences.pendingApprovalRequestId = null
            }
            preferences.pending = false
            if (preferences.lastError == null) preferences.lastError = error.message
            throw error
        } finally {
            broadcastStateChanged()
        }
    }

    suspend fun submitFeedback(
        threadId: String,
        turnId: String,
        itemId: String,
        rating: FeedbackRating,
    ) {
        val requestId = UUID.randomUUID().toString()
        preferences.pendingFeedbackRequestId = requestId
        preferences.lastError = null
        try {
            send(BridgePayload.SubmitFeedback(requestId, threadId, turnId, itemId, rating))
            for (waitMillis in FEEDBACK_REPLY_DELAYS_MS) {
                delay(waitMillis)
                refreshInboxBatch(notify = true)
                if (preferences.pendingFeedbackRequestId != requestId) break
            }
            if (preferences.pendingFeedbackRequestId == requestId) {
                preferences.pendingFeedbackRequestId = null
                error("Codex did not acknowledge the feedback. Keep the private bridge running, then retry.")
            }
            preferences.lastError?.let(::error)
        } catch (error: Throwable) {
            if (preferences.pendingFeedbackRequestId == requestId) {
                preferences.pendingFeedbackRequestId = null
            }
            if (preferences.lastError == null) preferences.lastError = error.message
            throw error
        } finally {
            broadcastStateChanged()
        }
    }

    suspend fun refreshInbox(notify: Boolean = true): Int {
        return refreshInboxBatch(notify).handled
    }

    suspend fun refreshInboxAndSessions(notify: Boolean = true, notifyAfterMillis: Long? = null) {
        refreshInboxBatch(notify, notifyAfterMillis)
        syncSessions()
        for (waitMillis in SESSION_REPLY_DELAYS_MS) {
            delay(waitMillis)
            if (refreshInboxBatch(notify, notifyAfterMillis).receivedSessionSnapshot) return
        }
    }

    private suspend fun refreshInboxBatch(
        notify: Boolean,
        notifyAfterMillis: Long? = null,
    ): InboxRefreshResult = inboxRefreshMutex.withLock {
        val pairing = pairingStore.read() ?: return@withLock InboxRefreshResult(0, false)
        val envelopes = relay.fetchInbox(pairing)
        val acknowledged = mutableListOf<String>()
        var handled = 0
        var receivedSessionSnapshot = false
        envelopes.forEach { envelope ->
            val messageId = envelope.optString("messageId")
            val sentAt = envelope.optLong("sentAt")
            runCatching { crypto.decrypt(pairing.pairId, pairing.bridgePublicKey, envelope) }
                .onSuccess { payload ->
                    processPayload(payload, notify, notifyAfterMillis, messageId, sentAt)
                    if (payload.optString("kind") == "sessions.snapshot") receivedSessionSnapshot = true
                    if (messageId.isNotBlank()) acknowledged += messageId
                    handled += 1
                }
        }
        relay.acknowledge(pairing, acknowledged)
        if (handled > 0) broadcastStateChanged()
        InboxRefreshResult(handled, receivedSessionSnapshot)
    }

    suspend fun updateFcmRegistration(installationId: String) {
        pairingStore.read()?.let { relay.updateFcmRegistration(it, installationId) }
    }

    fun disconnect() {
        pairingStore.clear()
        crypto.clearPairingKey()
        preferences.sessions = emptyList()
        preferences.models = emptyList()
        preferences.latestAlert = null
        preferences.transcript = null
        preferences.revisionBase = null
        preferences.chatSnapshot = null
        preferences.chatFeedback = emptyMap()
        preferences.pendingTurnRequestId = null
        preferences.pendingChatRequestId = null
        pendingChatRefreshStartedAtMillis = 0L
        preferences.pendingFeedbackRequestId = null
        preferences.pendingApprovalRequestId = null
        preferences.lastAcceptedThreadId = null
        preferences.lastAcceptedTurnRequestId = null
        preferences.lastSendNotice = null
        preferences.pending = false
        preferences.lastError = null
        broadcastStateChanged()
    }

    private suspend fun send(payload: BridgePayload) {
        val pairing = pairingStore.read() ?: error("Pair Agentic Wear first")
        val plaintext = PayloadCodec.encode(payload)
        relay.sendToBridge(pairing, crypto.encrypt(pairing.pairId, pairing.bridgePublicKey, plaintext))
    }

    private fun processPayload(
        payload: JSONObject,
        notify: Boolean,
        notifyAfterMillis: Long?,
        envelopeMessageId: String,
        envelopeSentAt: Long,
    ) {
        when (payload.optString("kind")) {
            "sessions.snapshot" -> {
                preferences.sessions = PayloadCodec.decodeSessions(payload)
                if (payload.has("models")) preferences.models = PayloadCodec.decodeModels(payload)
                preferences.lastError = null
            }
            "transcription.ready" -> {
                val transcript = PayloadCodec.decodeTranscript(payload) ?: return
                val requestId = transcript.requestId
                when {
                    preferences.consumeCancelledTranscription(requestId) -> Unit
                    shouldAcceptTranscriptionResult(
                        pendingRequestId = preferences.pendingTranscriptionRequestId,
                        incomingRequestId = requestId,
                    ) -> {
                        preferences.transcript = transcript
                        preferences.revisionBase = null
                        preferences.pendingTranscriptionRequestId = null
                        preferences.pending = false
                        preferences.lastError = null
                    }
                }
            }
            "chat.snapshot" -> {
                PayloadCodec.decodeChatSnapshot(payload)?.let { snapshot ->
                    if (
                        shouldAcceptChatSnapshot(
                            selectedThreadId = preferences.selectedThreadId,
                            pendingRequestId = preferences.pendingChatRequestId,
                            currentGeneratedAtMillis = preferences.chatSnapshot?.generatedAtMillis,
                            incomingThreadId = snapshot.threadId,
                            incomingRequestId = snapshot.requestId,
                            incomingGeneratedAtMillis = snapshot.generatedAtMillis,
                        )
                    ) {
                        preferences.chatSnapshot = snapshot
                        if (snapshot.requestId == preferences.pendingChatRequestId) {
                            preferences.pendingChatRequestId = null
                            pendingChatRefreshStartedAtMillis = 0L
                        }
                        preferences.lastError = null
                    }
                }
            }
            "terminal.completed", "terminal.failed", "terminal.interrupted", "terminal.blocked",
            "approval.request" -> PayloadCodec.decodeAlert(payload)?.let { alert ->
                preferences.latestAlert = alert
                preferences.pending = false
                preferences.lastError = null
                val firstDelivery = preferences.markEventHandled(alert.eventId)
                if (firstDelivery && shouldPostAlertNotification(notify, alert.occurredAtMillis, notifyAfterMillis)) {
                    AgentNotifier.post(context, alert)
                }
            }
            "chat.error" -> {
                val requestId = payload.optString("requestId")
                if (
                    shouldAcceptChatError(
                        selectedThreadId = preferences.selectedThreadId,
                        pendingRequestId = preferences.pendingChatRequestId,
                        incomingThreadId = payload.optString("threadId"),
                        incomingRequestId = requestId,
                    )
                ) {
                    preferences.pendingChatRequestId = null
                    pendingChatRefreshStartedAtMillis = 0L
                    preferences.lastError = payload.optString("message", "Could not load this Codex chat")
                }
            }
            "transcription.error", "turn.error", "approval.error", "bridge.error" -> {
                val errorKind = payload.optString("kind")
                val requestId = payload.optString("requestId")
                if (errorKind == "transcription.error") {
                    val cancelled = preferences.consumeCancelledTranscription(requestId)
                    val expected = shouldAcceptTranscriptionResult(
                        pendingRequestId = preferences.pendingTranscriptionRequestId,
                        incomingRequestId = requestId,
                    )
                    if (cancelled || !expected) return
                    preferences.pendingTranscriptionRequestId = null
                }
                val staleTurnError = errorKind == "turn.error" &&
                    !shouldAcceptTurnError(preferences.pendingTurnRequestId, requestId)
                if (!staleTurnError) preferences.pending = false
                if (errorKind == "transcription.error") {
                    preferences.revisionBase?.let { preferences.transcript = it }
                    preferences.revisionBase = null
                }
                if (errorKind == "turn.error" && requestId == preferences.pendingTurnRequestId) {
                    preferences.pendingTurnRequestId = null
                }
                if (errorKind == "approval.error" && requestId == preferences.pendingApprovalRequestId) {
                    preferences.pendingApprovalRequestId = null
                }
                val selectedSession = preferences.sessions.firstOrNull { it.id == preferences.selectedThreadId }
                    ?: preferences.sessions.firstOrNull()
                val alert = PayloadCodec.decodeRequestError(
                    json = payload,
                    envelopeMessageId = envelopeMessageId,
                    envelopeSentAt = envelopeSentAt,
                    fallbackThreadId = selectedSession?.id,
                    fallbackTitle = selectedSession?.title,
                )
                if (!staleTurnError) {
                    preferences.lastError = alert?.detail
                        ?: payload.optString("message", "The request could not be completed")
                }
                if (alert != null && !staleTurnError) {
                    preferences.latestAlert = alert
                    val firstDelivery = preferences.markEventHandled(alert.eventId)
                    if (firstDelivery && shouldPostAlertNotification(notify, alert.occurredAtMillis, notifyAfterMillis)) {
                        AgentNotifier.post(context, alert)
                    }
                }
            }
            "turn.accepted" -> {
                if (payload.optString("requestId") == preferences.pendingTurnRequestId) {
                    val requestId = payload.optString("requestId")
                    preferences.pendingTurnRequestId = null
                    preferences.lastAcceptedThreadId = payload.optString("threadId").takeIf(String::isNotBlank)
                    preferences.lastAcceptedTurnRequestId = requestId
                    preferences.lastSendNotice = payload.optString("message").takeIf(String::isNotBlank)
                    preferences.transcript = null
                    preferences.revisionBase = null
                    preferences.pending = false
                    preferences.lastError = null
                }
            }
            "turn.started" -> {
                if (payload.optString("requestId") == preferences.lastAcceptedTurnRequestId) {
                    preferences.lastSendNotice = payload.optString("message").takeIf(String::isNotBlank)
                    preferences.lastError = null
                }
            }
            "approval.accepted" -> {
                if (payload.optString("requestId") == preferences.pendingApprovalRequestId) {
                    preferences.pendingApprovalRequestId = null
                    preferences.pending = false
                    preferences.lastError = null
                    val approvalId = payload.optString("approvalId")
                    preferences.chatSnapshot?.let { snapshot ->
                        preferences.chatSnapshot = snapshot.copy(
                            messages = snapshot.messages.map { message ->
                                if (message.approvalId == approvalId) {
                                    message.copy(canControl = false, resolved = true)
                                } else {
                                    message
                                }
                            },
                        )
                    }
                }
            }
            "feedback.accepted" -> {
                if (payload.optString("requestId") == preferences.pendingFeedbackRequestId) {
                    preferences.pendingFeedbackRequestId = null
                    val itemId = payload.optString("itemId")
                    val rating = when (payload.optString("rating")) {
                        "liked" -> FeedbackRating.LIKED
                        "disliked" -> FeedbackRating.DISLIKED
                        else -> null
                    }
                    if (itemId.isNotBlank() && rating != null) {
                        val updated = LinkedHashMap(preferences.chatFeedback)
                        updated.remove(itemId)
                        updated[itemId] = rating
                        preferences.chatFeedback = updated
                    }
                    preferences.lastError = null
                }
            }
            "feedback.error" -> {
                if (payload.optString("requestId") == preferences.pendingFeedbackRequestId) {
                    preferences.pendingFeedbackRequestId = null
                    preferences.lastError = payload.optString("message", "Could not send feedback")
                }
            }
        }
    }

    private fun broadcastStateChanged() {
        context.sendBroadcast(Intent(ACTION_STATE_CHANGED).setPackage(context.packageName))
    }

    companion object {
        private const val CHAT_REFRESH_REQUEST_TIMEOUT_MS = 5_000L
        const val ACTION_STATE_CHANGED = "io.github.sirbughunter.agenticwear.STATE_CHANGED"
        private const val MAX_RECORDING_BYTES = 1_300_000
        private val SESSION_REPLY_DELAYS_MS = longArrayOf(150, 300, 600, 1_200)
        private val TURN_REPLY_DELAYS_MS = longArrayOf(150, 250, 400, 600, 900, 1_200, 1_600, 2_000, 2_500, 3_000, 2_500)
        private val CHAT_REPLY_DELAYS_MS = longArrayOf(150, 250, 400, 700, 1_000, 1_500, 2_000, 2_500, 3_000)
        private val FEEDBACK_REPLY_DELAYS_MS = longArrayOf(150, 250, 400, 700, 1_000, 1_500, 2_000, 3_000)
        private val APPROVAL_REPLY_DELAYS_MS = longArrayOf(150, 250, 400, 700, 1_000, 1_500, 2_000, 3_000)
        private val inboxRefreshMutex = Mutex()
    }
}

private data class InboxRefreshResult(
    val handled: Int,
    val receivedSessionSnapshot: Boolean,
)

internal fun transcriptionReplyDelaysMs(): LongArray =
    longArrayOf(150, 200, 250, 350, 500, 700, 1_000, 500, 700, 900, 1_200, 1_600, 2_000)

internal fun shouldAcceptTranscriptionResult(
    pendingRequestId: String?,
    incomingRequestId: String,
): Boolean = pendingRequestId != null && incomingRequestId == pendingRequestId

internal fun shouldAcceptChatSnapshot(
    selectedThreadId: String?,
    pendingRequestId: String?,
    currentGeneratedAtMillis: Long?,
    incomingThreadId: String,
    incomingRequestId: String?,
    incomingGeneratedAtMillis: Long,
): Boolean {
    if (selectedThreadId == null || incomingThreadId != selectedThreadId) return false
    if (currentGeneratedAtMillis != null && incomingGeneratedAtMillis < currentGeneratedAtMillis) return false
    return incomingRequestId == null || pendingRequestId == null || incomingRequestId == pendingRequestId
}

internal fun shouldAcceptChatError(
    selectedThreadId: String?,
    pendingRequestId: String?,
    incomingThreadId: String,
    incomingRequestId: String,
): Boolean = selectedThreadId != null &&
    incomingThreadId == selectedThreadId &&
    pendingRequestId != null &&
    incomingRequestId == pendingRequestId

internal fun shouldAcceptTurnError(
    pendingRequestId: String?,
    incomingRequestId: String,
): Boolean = pendingRequestId != null && incomingRequestId == pendingRequestId
