package io.github.sirbughunter.agenticwear.notification

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class AgenticWearMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        // Wall clock, so the bridge can compare it with its own timestamps.
        val pushReceivedAt = System.currentTimeMillis()
        if (message.data["kind"] == "inbox.ready") InboxSyncWorker.enqueue(this, pushReceivedAt)
    }

    override fun onRegistered(installationId: String) {
        InboxSyncWorker.enqueueRegistration(this, installationId)
    }
}
