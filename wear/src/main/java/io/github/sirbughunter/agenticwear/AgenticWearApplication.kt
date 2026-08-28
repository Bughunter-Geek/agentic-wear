package io.github.sirbughunter.agenticwear

import android.app.Application
import io.github.sirbughunter.agenticwear.data.FirebaseProvider
import io.github.sirbughunter.agenticwear.notification.AgentNotifier
import io.github.sirbughunter.agenticwear.notification.InboxSyncWorker
import io.github.sirbughunter.agenticwear.voice.VoiceSessionService

class AgenticWearApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        AgentNotifier.createChannels(this)
        VoiceSessionService.createNotificationChannel(this)
        if (FirebaseProvider.initialize(this)) {
            InboxSyncWorker.enqueueRegistrationRefresh(this)
        }
    }
}
