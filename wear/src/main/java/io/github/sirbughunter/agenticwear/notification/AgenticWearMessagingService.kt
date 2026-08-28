package io.github.sirbughunter.agenticwear.notification

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class AgenticWearMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        if (message.data["kind"] == "inbox.ready") InboxSyncWorker.enqueue(this)
    }

    override fun onRegistered(installationId: String) {
        InboxSyncWorker.enqueueRegistration(this, installationId)
    }
}
