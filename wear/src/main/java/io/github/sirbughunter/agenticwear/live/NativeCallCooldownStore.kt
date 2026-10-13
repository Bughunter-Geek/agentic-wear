package io.github.sirbughunter.agenticwear.live

import android.content.Context
import android.os.SystemClock

/** Only catalog-verified native Dot calls create a per-task cooldown. */
internal object NativeCallCooldownStore {
    private fun key(thread: String) = "native_voice_ended_at_$thread"
    fun remainingMs(context: Context, thread: String?): Long {
        if (thread.isNullOrBlank()) return 0
        val prefs = context.getSharedPreferences("agentic_wear_state", Context.MODE_PRIVATE)
        val name = key(thread)
        return nativeCallCooldownRemainingMs(if (prefs.contains(name)) prefs.getLong(name, 0) else null,
            SystemClock.elapsedRealtime())
    }
    fun ended(context: Context, thread: String, nativeDot: Boolean) {
        if (!nativeDot || thread.isBlank()) return
        context.getSharedPreferences("agentic_wear_state", Context.MODE_PRIVATE).edit()
            .putLong(key(thread), SystemClock.elapsedRealtime()).apply()
    }
}
