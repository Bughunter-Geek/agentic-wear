package io.github.sirbughunter.agenticwear

import android.app.Application
import io.github.sirbughunter.agenticwear.data.FirebaseProvider
import io.github.sirbughunter.agenticwear.notification.AgentNotifier

class AgenticWearApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        AgentNotifier.createChannels(this)
        FirebaseProvider.initialize(this)
    }
}
