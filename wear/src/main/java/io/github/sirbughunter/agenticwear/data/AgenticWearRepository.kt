package io.github.sirbughunter.agenticwear.data

import android.content.Context
import android.content.Intent
import android.util.Base64
import io.github.sirbughunter.agenticwear.model.BridgePayload
import io.github.sirbughunter.agenticwear.model.ChatSnapshot
import io.github.sirbughunter.agenticwear.model.FeedbackRating
import io.github.sirbughunter.agenticwear.model.withEditBase
import io.github.sirbughunter.agenticwear.model.Transcript
import io.github.sirbughunter.agenticwear.model.FollowUpAction
import io.github.sirbughunter.agenticwear.model.terminalSubmissionPhase
import io.github.sirbughunter.agenticwear.model.SubmittedTurn
import io.github.sirbughunter.agenticwear.model.SubmissionPhase
import io.github.sirbughunter.agenticwear.model.submissionPhaseFromWire
import io.github.sirbughunter.agenticwear.notification.AgentNotifier
import io.github.sirbughunter.agenticwear.notification.NotifyTrace
import io.github.sirbughunter.agenticwear.notification.NotifyTraceRecorder
import io.github.sirbughunter.agenticwear.notification.alertDecision
import io.github.sirbughunter.agenticwear.notification.shouldPostAlertNotification
import io.github.sirbughunter.agenticwear.tile.RecentSessionsTileService
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import android.os.SystemClock
import io.github.sirbughunter.agenticwear.voice.VoiceLatency
import org.json.JSONObject

class AgenticWearRepository(private val context: Context) {
    private var pendingChatRefreshStartedAtMillis = 0L
    private val pairingStore = SecurePairingStore(context)
    private val preferences = AppPreferences(context)
    private val crypto = CryptoBox(context)
    private val relay = RelayApi()

    val isPaired: Boolean get() = pairingStore.read() != null

    fun restoreUnconfirmedTurn() {
        val id = preferences.pendingTurnRequestId ?: return
        if (activeTurnConfirmations.contains(id)) return
        preferences.pending = false
        preferences.updateSubmittedTurn(id) { it.progress(SubmissionPhase.UNCERTAIN) }
    }

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

    suspend fun prepareDraft() {
        if (preferences.transcriptionEngine.bridgeBackend == "phonon" || preferences.revisionBase != null) {
            send(BridgePayload.PrepareDraft(UUID.randomUUID().toString()))
        }
    }

    fun canRetryTranscript(requestId: String): Boolean =
        recordingRetry.available(requestId, SystemClock.elapsedRealtime())

    fun clearRetryRecording() {
        retryExpiryJob?.cancel()
        retryExpiryJob = null
        recordingRetry.clear()
    }

    suspend fun retryTranscript(previousReview: Transcript, requestId: String, notifyAfterMillis: Long? = null): String {
        check(!preferences.pending && preferences.pendingTranscriptionRequestId == null) { "A voice request is already active" }
        check(preferences.transcriptionEngine.usesBridge) { "Retry requires a Mac transcriber" }
        val replay = recordingRetry.replay(previousReview.requestId, requestId, SystemClock.elapsedRealtime())
            ?: error("Recording expired. Record again to enable Retry.")
        // Undo/cancellation returns the review, while the wire payload uses the
        // original edit base so replaying a voice edit never applies it twice.
        preferences.revisionBase = previousReview
        return transcribeBytes(replay.bytes, replay.threadId, requestId, replay.revisionBase, notifyAfterMillis)
    }

    suspend fun transcribe(
        audioFile: File,
        threadId: String?,
        requestId: String,
        notifyAfterMillis: Long? = null,
    ): String {
        val bytes = audioFile.readBytes()
        try {
            require(bytes.isNotEmpty() && bytes.size <= MAX_RECORDING_BYTES) { "Recording is too large; keep it under four minutes" }
            if (preferences.isTranscriptionCancelled(requestId)) throw CancellationException("Transcription was cancelled")
            recordingRetry.retain(bytes, requestId, threadId, preferences.revisionBase, SystemClock.elapsedRealtime())
            retryExpiryJob?.cancel()
            retryExpiryJob = retryScope.launch {
                delay(30L * 60L * 1_000L)
                recordingRetry.expire(SystemClock.elapsedRealtime())
                broadcastStateChanged()
            }
            return transcribeBytes(bytes, threadId, requestId, preferences.revisionBase, notifyAfterMillis) {
                check(audioFile.delete() || !audioFile.exists()) { "Could not remove the sent recording" }
            }
        } finally {
            bytes.fill(0)
            audioFile.delete()
        }
    }

    private suspend fun transcribeBytes(
        bytes: ByteArray,
        threadId: String?,
        requestId: String,
        revisionBase: Transcript?,
        notifyAfterMillis: Long?,
        afterUpload: () -> Unit = {},
    ): String {
        val uploadStarted = SystemClock.elapsedRealtime()
        try {
            if (preferences.isTranscriptionCancelled(requestId)) {
                throw kotlinx.coroutines.CancellationException("Transcription was cancelled")
            }
            require(bytes.isNotEmpty() && bytes.size <= MAX_RECORDING_BYTES) { "Recording is too large; keep it under four minutes" }
            preferences.pending = true
            preferences.pendingTranscriptionRequestId = requestId
            preferences.transcript = null
            preferences.lastError = null
            send(
                recordingTranscriptionPayload(
                    requestId, Base64.encodeToString(bytes, Base64.NO_WRAP), threadId,
                    revisionBase, preferences.transcriptionEngine.bridgeBackend,
                ),
            )
            VoiceLatency.duration("upload", uploadStarted)
            afterUpload()
            for (waitMillis in transcriptionReplyDelaysMs()) {
                delay(waitMillis)
                refreshInboxBatch(notify = true, notifyAfterMillis = notifyAfterMillis)
                if (shouldFinishTranscriptionWait(requestId, preferences.pendingTranscriptionRequestId, preferences.transcript?.requestId)) break
            }
            return requestId
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            if (preferences.pendingTranscriptionRequestId == requestId ||
                preferences.pendingTranscriptionRequestId == null && preferences.isTranscriptionCancelled(requestId)) {
                preferences.revisionBase?.let { preferences.transcript = it }
                preferences.revisionBase = null
                preferences.pendingTranscriptionRequestId = null
                preferences.pending = false
            }
            throw cancelled
        } catch (error: Throwable) {
            preferences.revisionBase?.let { preferences.transcript = it }
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
        onPrepared: () -> Unit = {},
    ): String {
        require(text.isNotBlank()) { "Transcript is empty" }
        clearRetryRecording()
        // An unacknowledged POST may already be executing. Checking again must
        // retain its identity and must not dispatch a duplicate prompt.
        val pairing = pairingStore.read() ?: error("Pair Agentic Wear first")
        fun payload(id: String) = BridgePayload.SubmitTurn(id, threadId, text.trim(), model, effort, followUpAction)
        val fingerprint = java.security.MessageDigest.getInstance("SHA-256")
            .digest(PayloadCodec.encode(payload("")).toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        val delivery = prepareTurnDelivery(
            preferences.pendingTurnRequestId,
            preferences.pendingTurnEnvelope,
            preferences.pendingTurnFingerprint,
            fingerprint,
            createEnvelope = { id ->
                crypto.encrypt(pairing.pairId, pairing.bridgePublicKey, PayloadCodec.encode(payload(id))).toString()
            },
            persist = preferences::savePendingTurnDelivery,
        )
        val requestId = delivery.requestId
        val envelope = JSONObject(delivery.envelope)
        preferences.changeSubmittedTurns { items ->
            if (items.any { it.requestId == requestId }) items
            else items + SubmittedTurn(requestId, threadId, text.trim(), System.currentTimeMillis())
        }
        onPrepared()
        return awaitTurnConfirmation(requestId) { relay.sendToBridge(pairing, envelope) }
    }

    /** Reuse the original encrypted request; a status retry never creates another prompt. */
    suspend fun retryTurnConfirmation(): String {
        val requestId = preferences.pendingTurnRequestId ?: error("There is no unconfirmed message to check")
        val envelope = preferences.pendingTurnEnvelope ?: error("Original delivery is unavailable. Check this chat in Codex before sending again.")
        val pairing = pairingStore.read() ?: error("Pair Agentic Wear first")
        return awaitTurnConfirmation(requestId) { relay.sendToBridge(pairing, JSONObject(envelope)) }
    }

    private suspend fun awaitTurnConfirmation(requestId: String, sendOriginal: suspend () -> Unit): String {
        check(activeTurnConfirmations.add(requestId)) { "Already checking this message's delivery. No new copy was sent." }
        try {
            preferences.pending = true
            preferences.pendingTurnRequestId = requestId
            preferences.lastAcceptedThreadId = null
            preferences.lastAcceptedTurnRequestId = null
            preferences.lastSendNotice = null
            preferences.lastError = null
            broadcastStateChanged()
            // Retransmit the same authenticated ciphertext. The bridge replays
            // its durable receipt and cannot dispatch this envelope twice.
            sendOriginal()
            for (waitMillis in TURN_REPLY_DELAYS_MS) {
                delay(waitMillis)
                refreshInboxBatch(notify = true)
                if (preferences.pendingTurnRequestId != requestId) break
            }
            preferences.lastError?.let(::error)
            if (preferences.pendingTurnRequestId == requestId) {
                preferences.pending = false
                val message = "Still waiting for Codex to confirm this prompt. It may already be running. Retry checks for its confirmation without sending another copy."
                preferences.lastError = message
                preferences.updateSubmittedTurn(requestId) { it.progress(SubmissionPhase.UNCERTAIN) }
                error(message)
            }
            preferences.lastError?.let(::error)
            return preferences.lastAcceptedThreadId
                ?: error("Codex accepted the request without returning a session. Refresh Sessions and retry.")
        } catch (cancelled: CancellationException) {
            preferences.pending = false
            preferences.updateSubmittedTurn(requestId) { it.progress(SubmissionPhase.UNCERTAIN) }
            throw cancelled
        } catch (error: Throwable) {
            preferences.pending = false
            if (preferences.pendingTurnRequestId == requestId) {
                preferences.updateSubmittedTurn(requestId) { it.progress(SubmissionPhase.UNCERTAIN) }
            }
            if (preferences.lastError == null) preferences.lastError = error.message
            throw error
        } finally {
            activeTurnConfirmations.remove(requestId)
            broadcastStateChanged()
        }
    }

    suspend fun watchChat(threadId: String): ChatSnapshot? {
        require(threadId.isNotBlank()) { "Choose a Codex session first" }
        val requestId = UUID.randomUUID().toString()
        preferences.pendingChatRequestId = requestId
        pendingChatRefreshStartedAtMillis = System.currentTimeMillis()
        preferences.lastReadyChatRequestId = null
        preferences.lastError = null
        send(BridgePayload.WatchChat(requestId, threadId))
        for (waitMillis in CHAT_REPLY_DELAYS_MS) {
            delay(waitMillis)
            refreshInboxBatch(notify = true)
            preferences.chatSnapshot
                ?.takeIf { it.threadId == threadId && isAcknowledgedChatRead(requestId, it.requestId, preferences.lastReadyChatRequestId) }
                ?.let { return it }
            if (preferences.pendingChatRequestId != requestId) break
        }
        val snapshot = preferences.chatSnapshot?.takeIf { it.threadId == threadId && isAcknowledgedChatRead(requestId, it.requestId, preferences.lastReadyChatRequestId) }
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
        } catch (cancelled: CancellationException) {
            if (preferences.pendingApprovalRequestId == requestId) {
                preferences.pendingApprovalRequestId = null
            }
            preferences.pending = false
            throw cancelled
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
        } catch (cancelled: CancellationException) {
            if (preferences.pendingFeedbackRequestId == requestId) {
                preferences.pendingFeedbackRequestId = null
            }
            throw cancelled
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

    /**
     * [pushReceivedAt] (Watch wall clock) is set only for refreshes started by an FCM push. It enables
     * a metadata-only `notify.trace` to the bridge; it never changes what is fetched or notified.
     */
    suspend fun refreshInbox(notify: Boolean = true, pushReceivedAt: Long? = null): Int {
        return refreshInboxBatch(notify, pushReceivedAt = pushReceivedAt).handled
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
        pushReceivedAt: Long? = null,
    ): InboxRefreshResult {
        val trace = pushReceivedAt?.let(::NotifyTraceRecorder)
        val result = refreshInboxExclusively(notify, notifyAfterMillis, trace)
        // After the lock is released, so a slow relay can never hold up other inbox refreshes.
        trace?.result()?.let { sendNotifyTraceBestEffort(it) }
        return result
    }

    private suspend fun refreshInboxExclusively(
        notify: Boolean,
        notifyAfterMillis: Long?,
        trace: NotifyTraceRecorder?,
    ): InboxRefreshResult = inboxRefreshMutex.withLock {
        val pairing = pairingStore.read() ?: return@withLock InboxRefreshResult(0, false)
        val fetchedAt = SystemClock.elapsedRealtime()
        trace?.fetchStarted(System.currentTimeMillis())
        val envelopes = relay.fetchInbox(pairing)
        trace?.fetchCompleted(System.currentTimeMillis())
        VoiceLatency.duration("inbox_fetch", fetchedAt)
        val acknowledged = mutableListOf<String>()
        var handled = 0
        var receivedSessionSnapshot = false
        envelopes.forEach { envelope ->
            val messageId = envelope.optString("messageId")
            if (recentInboxMessages.handled(messageId)) {
                // Already processed; only its asynchronous acknowledgement was still in flight.
                acknowledged += messageId
                return@forEach
            }
            val sentAt = envelope.optLong("sentAt")
            runCatching { crypto.decrypt(pairing.pairId, pairing.bridgePublicKey, envelope) }
                .onSuccess { payload ->
                    processPayload(payload, notify, notifyAfterMillis, messageId, sentAt, trace)
                    if (payload.optString("kind") == "sessions.snapshot") receivedSessionSnapshot = true
                    if (messageId.isNotBlank()) {
                        acknowledged += messageId
                        recentInboxMessages.remember(messageId)
                    }
                    handled += 1
                }
        }
        val acknowledgedAt = SystemClock.elapsedRealtime()
        publishBeforeAcknowledgement(
            publish = { if (handled > 0) broadcastStateChanged() },
            queue = inboxAcknowledgements,
            acknowledge = { relay.acknowledge(pairing, acknowledged); VoiceLatency.duration("inbox_ack", acknowledgedAt) },
        )
        InboxRefreshResult(handled, receivedSessionSnapshot)
    }

    suspend fun updateFcmRegistration(installationId: String) {
        pairingStore.read()?.let { relay.updateFcmRegistration(it, installationId) }
    }

    fun disconnect() {
        clearRetryRecording()
        pairingStore.clear()
        crypto.clearPairingKey()
        preferences.sessions = emptyList()
        preferences.changeSubmittedTurns { emptyList() }
        preferences.localInventoryComplete = null
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
        RecentSessionsTileService.requestUpdate(context)
        broadcastStateChanged()
    }

    private suspend fun send(payload: BridgePayload) = sendEncoded(PayloadCodec.encode(payload))

    private suspend fun sendEncoded(plaintext: String) {
        val pairing = pairingStore.read() ?: error("Pair Agentic Wear first")
        relay.sendToBridge(pairing, crypto.encrypt(pairing.pairId, pairing.bridgePublicKey, plaintext))
    }

    /** Diagnostics only: any failure or delay here is dropped and never reaches inbox handling or notifications. */
    private suspend fun sendNotifyTraceBestEffort(trace: NotifyTrace) {
        try {
            withTimeoutOrNull(NOTIFY_TRACE_SEND_TIMEOUT_MS) {
                sendEncoded(PayloadCodec.encodeNotifyTrace(UUID.randomUUID().toString(), trace))
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Best effort by design.
        }
    }

    private fun processPayload(
        payload: JSONObject,
        notify: Boolean,
        notifyAfterMillis: Long?,
        envelopeMessageId: String,
        envelopeSentAt: Long,
        trace: NotifyTraceRecorder? = null,
    ) {
        if (payload.optString("kind").startsWith("live.")) {
            io.github.sirbughunter.agenticwear.live.LiveSignaling.receive(payload, context)
            return
        }
        when (payload.optString("kind")) {
            "sessions.snapshot" -> {
                preferences.sessions = PayloadCodec.decodeSessions(payload)
                preferences.localInventoryComplete = payload.optJSONObject("discovery")
                    ?.takeIf { it.optString("scope") == "local" }?.optBoolean("complete", false)
                if (payload.has("models")) preferences.models = PayloadCodec.decodeModels(payload)
                // Catalog refresh is unrelated to a failed chat/dictation request.
                RecentSessionsTileService.requestUpdate(context)
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
                        preferences.transcript = preferences.revisionBase?.let { base ->
                            transcript.withEditBase(base)
                        } ?: transcript
                        preferences.revisionBase = null
                        preferences.pendingTranscriptionRequestId = null
                        preferences.pending = false
                        preferences.lastError = null
                        VoiceLatency.ready()
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
                        preferences.changeSubmittedTurns { items -> items.map { it.reconcile(snapshot) } }
                        if (snapshot.requestId != null && snapshot.requestId == preferences.pendingChatRequestId) {
                            preferences.lastReadyChatRequestId = snapshot.requestId
                            preferences.lastError = null
                            preferences.pendingChatRequestId = null
                            pendingChatRefreshStartedAtMillis = 0L
                        }
                    }
                }
            }
            "terminal.completed", "terminal.failed", "terminal.interrupted", "terminal.blocked",
            "approval.request" -> PayloadCodec.decodeAlert(payload)?.let { alert ->
                preferences.latestAlert = alert
                if (preferences.pendingTurnRequestId == null) preferences.pending = false
                if (payload.optString("kind") in setOf("terminal.completed", "terminal.failed", "terminal.interrupted")) {
                    val requestId = payload.optString("requestId")
                    if (requestId.isNotBlank()) preferences.updateSubmittedTurn(requestId) {
                        if (it.threadId != alert.threadId) it else it.progress(terminalSubmissionPhase(payload.optString("kind"), payload.optString("deliveryState"), it.phase))
                    }
                }
                val firstDelivery = preferences.markEventHandled(alert.eventId)
                if (firstDelivery && shouldPostAlertNotification(notify, alert.occurredAtMillis, notifyAfterMillis)) {
                    AgentNotifier.post(context, alert)
                }
                if (trace != null && payload.optString("kind").startsWith("terminal.")) {
                    trace.alertDecided(
                        alert.eventId,
                        alertDecision(firstDelivery, notify, alert.occurredAtMillis, notifyAfterMillis),
                        System.currentTimeMillis(),
                    )
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
                val deferredFailure = errorKind == "turn.error" && payload.optBoolean("deferred")
                val expectedTurnRequestId = preferences.pendingTurnRequestId
                    ?: preferences.lastAcceptedTurnRequestId.takeIf { deferredFailure }
                val staleTurnError = errorKind == "turn.error" &&
                    !shouldAcceptTurnError(expectedTurnRequestId, requestId)
                if (deferredFailure && !staleTurnError) {
                    payload.optString("draftText").takeIf { it.isNotBlank() && it.length <= 12_000 }?.let { draft ->
                        preferences.transcript = Transcript(requestId, draft, payload.optString("threadId").takeIf(String::isNotBlank))
                    }
                    preferences.lastAcceptedTurnRequestId = null
                }
                if (!staleTurnError) preferences.pending = false
                if (errorKind == "transcription.error") {
                    preferences.revisionBase?.let { preferences.transcript = it }
                    preferences.revisionBase = null
                }
                if (errorKind == "turn.error" && requestId == preferences.pendingTurnRequestId &&
                    !payload.optBoolean("deliveryUncertain")) {
                    preferences.pendingTurnRequestId = null
                }
                if (errorKind == "turn.error" && !staleTurnError) {
                    preferences.updateSubmittedTurn(requestId) { it.progress(if (payload.optBoolean("deliveryUncertain")) SubmissionPhase.UNCERTAIN else SubmissionPhase.FAILED) }
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
                    val acceptedThreadId = payload.optString("threadId").takeIf(String::isNotBlank)
                    preferences.lastAcceptedThreadId = acceptedThreadId
                    if (acceptedThreadId != null) {
                        preferences.selectedThreadId = acceptedThreadId
                    }
                    preferences.lastAcceptedTurnRequestId = requestId
                    preferences.updateSubmittedTurn(requestId) {
                        it.progress(if (payload.optString("state") == "waiting") SubmissionPhase.QUEUED else SubmissionPhase.ACCEPTED, acceptedThreadId)
                    }
                    preferences.lastSendNotice = payload.optString("message").takeIf(String::isNotBlank)
                    preferences.transcript = null
                    preferences.revisionBase = null
                    preferences.pending = false
                    preferences.lastError = null
                }
            }
            "turn.started" -> {
                val requestId = payload.optString("requestId")
                preferences.updateSubmittedTurn(requestId) {
                        it.progress(submissionPhaseFromWire(payload.optString("deliveryState")) ?: if (payload.optBoolean("selectionApplied")) SubmissionPhase.RUNNING else it.phase,
                            payload.optString("threadId").takeIf(String::isNotBlank), payload.optString("nativeTurnId").takeIf { value -> value.isNotBlank() && value != "null" })
                }
                if (requestId == preferences.lastAcceptedTurnRequestId) {
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
        private val activeTurnConfirmations = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
        private const val CHAT_REFRESH_REQUEST_TIMEOUT_MS = 5_000L
        private const val NOTIFY_TRACE_SEND_TIMEOUT_MS = 4_000L
        const val ACTION_STATE_CHANGED = "io.github.sirbughunter.agenticwear.STATE_CHANGED"
        private const val MAX_RECORDING_BYTES = 1_300_000
        private val recordingRetry = RecordingRetryCache()
        private val retryScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        private var retryExpiryJob: kotlinx.coroutines.Job? = null
        private val SESSION_REPLY_DELAYS_MS = longArrayOf(150, 300, 600, 1_200)
        private val TURN_REPLY_DELAYS_MS = longArrayOf(150, 250, 400, 600, 900, 1_200, 1_600, 2_000, 2_500, 3_000, 2_500)
        private val CHAT_REPLY_DELAYS_MS = longArrayOf(150, 250, 400, 700, 1_000, 1_500, 2_000, 2_500, 3_000)
        private val FEEDBACK_REPLY_DELAYS_MS = longArrayOf(150, 250, 400, 700, 1_000, 1_500, 2_000, 3_000)
        private val APPROVAL_REPLY_DELAYS_MS = longArrayOf(150, 250, 400, 700, 1_000, 1_500, 2_000, 3_000)
        private val inboxRefreshMutex = Mutex()
        private val inboxAcknowledgements = InboxAcknowledgements(CoroutineScope(SupervisorJob() + Dispatchers.IO))
        private val recentInboxMessages = RecentInboxMessages()
    }
}

private data class InboxRefreshResult(
    val handled: Int,
    val receivedSessionSnapshot: Boolean,
)

internal fun transcriptionReplyDelaysMs(): LongArray =
    // Foreground voice only: avoid adding up to two seconds of scheduled
    // idle time after the Mac has finished. Requests remain sequential.
    LongArray(41) { index -> when (index) { 0 -> 150L; 1 -> 200L; else -> 250L } }

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
    if (selectedThreadId != null && incomingThreadId != selectedThreadId) return false
    if (selectedThreadId == null && (pendingRequestId == null || incomingRequestId != pendingRequestId)) return false
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

internal data class PendingTurnDelivery(val requestId: String, val envelope: String, val fingerprint: String)

internal fun prepareTurnDelivery(
    existingId: String?,
    existingEnvelope: String?,
    existingFingerprint: String?,
    fingerprint: String,
    createEnvelope: (String) -> String,
    persist: (PendingTurnDelivery) -> Unit,
): PendingTurnDelivery {
    if (existingId != null) {
        check(existingEnvelope != null && existingFingerprint == fingerprint) {
            "An earlier prompt is still awaiting confirmation. This edited prompt has not been sent. Refresh the earlier chat before sending a different prompt."
        }
        return PendingTurnDelivery(existingId, existingEnvelope, fingerprint)
    }
    val id = UUID.randomUUID().toString()
    return PendingTurnDelivery(id, createEnvelope(id), fingerprint).also(persist)
}

/** Unrelated chat/catalog errors must not end a still-pending dictation. */
internal fun shouldFinishTranscriptionWait(requestId: String, pendingRequestId: String?, readyRequestId: String?): Boolean =
    readyRequestId == requestId || pendingRequestId != requestId

/** A newer uncorrelated stream snapshot may replace the matching reply in the same inbox batch. */
internal fun isAcknowledgedChatRead(requestId: String, snapshotRequestId: String?, acknowledgedRequestId: String?): Boolean =
    snapshotRequestId == requestId || acknowledgedRequestId == requestId
