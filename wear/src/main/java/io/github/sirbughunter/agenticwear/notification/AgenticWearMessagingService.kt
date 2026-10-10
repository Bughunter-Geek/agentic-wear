package io.github.sirbughunter.agenticwear.notification

import io.github.sirbughunter.agenticwear.data.AgenticWearRepository
import io.github.sirbughunter.agenticwear.data.PUSH_OUTCOME_ERROR
import io.github.sirbughunter.agenticwear.data.PUSH_OUTCOME_NO_ENVELOPE
import io.github.sirbughunter.agenticwear.data.PUSH_OUTCOME_TIMEOUT
import io.github.sirbughunter.agenticwear.data.PushDiagnostics
import io.github.sirbughunter.agenticwear.data.PushRecord
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class AgenticWearMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        // Wall clock, so the bridge can compare it with its own timestamps.
        val pushReceivedAt = System.currentTimeMillis()
        if (message.data["kind"] != "inbox.ready") return
        val envelopeJson = message.data["envelope"]
        // Background builds get no network, so show the alert from the envelope carried in the push first.
        val outcome = if (envelopeJson == null) {
            PUSH_OUTCOME_NO_ENVELOPE
        } else {
            try {
                runBlocking {
                    withTimeoutOrNull(PUSHED_ENVELOPE_TIMEOUT_MS) {
                        AgenticWearRepository(applicationContext).processPushedEnvelope(envelopeJson, pushReceivedAt)
                    }
                } ?: PUSH_OUTCOME_TIMEOUT
            } catch (_: Throwable) {
                // Never crash the service; the normal inbox fetch still runs.
                PUSH_OUTCOME_ERROR
            }
        }
        // Metadata only; reported to the bridge after the next successful inbox fetch.
        PushDiagnostics.record(
            PushRecord(
                receivedAt = pushReceivedAt,
                sentTime = message.sentTime,
                priority = message.priority,
                originalPriority = message.originalPriority,
                envelopePresent = envelopeJson != null,
                envelopeChars = envelopeJson?.length ?: 0,
                outcome = outcome,
                outcomeAt = System.currentTimeMillis(),
            ),
        )
        InboxSyncWorker.enqueue(this, pushReceivedAt)
    }

    private companion object {
        const val PUSHED_ENVELOPE_TIMEOUT_MS = 5_000L
    }

    override fun onRegistered(installationId: String) {
        InboxSyncWorker.enqueueRegistration(this, installationId)
    }
}
