package io.github.sirbughunter.agenticwear.notification

import io.github.sirbughunter.agenticwear.data.AgenticWearRepository
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class AgenticWearMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        // Wall clock, so the bridge can compare it with its own timestamps.
        val pushReceivedAt = System.currentTimeMillis()
        if (message.data["kind"] != "inbox.ready") return
        // Background builds get no network, so show the alert from the envelope carried in the push first.
        message.data["envelope"]?.let { envelopeJson ->
            try {
                runBlocking {
                    withTimeoutOrNull(PUSHED_ENVELOPE_TIMEOUT_MS) {
                        AgenticWearRepository(applicationContext).processPushedEnvelope(envelopeJson, pushReceivedAt)
                    }
                }
            } catch (_: Throwable) {
                // Never crash the service; the normal inbox fetch still runs.
            }
        }
        InboxSyncWorker.enqueue(this, pushReceivedAt)
    }

    private companion object {
        const val PUSHED_ENVELOPE_TIMEOUT_MS = 5_000L
    }

    override fun onRegistered(installationId: String) {
        InboxSyncWorker.enqueueRegistration(this, installationId)
    }
}
