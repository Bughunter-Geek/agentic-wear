package io.github.sirbughunter.agenticwear.notification

import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.SoundPool
import android.os.SystemClock
import io.github.sirbughunter.agenticwear.R

internal const val POP_DEBOUNCE_MILLIS = 300L

internal fun shouldPlayPop(ringerMode: Int, interruptionFilter: Int): Boolean =
    ringerMode == AudioManager.RINGER_MODE_NORMAL &&
        (interruptionFilter == NotificationManager.INTERRUPTION_FILTER_ALL ||
            interruptionFilter == NotificationManager.INTERRUPTION_FILTER_UNKNOWN)

internal fun popDebounced(nowMillis: Long, lastPlayMillis: Long?): Boolean =
    lastPlayMillis != null && nowMillis - lastPlayMillis in 0 until POP_DEBOUNCE_MILLIS

internal object MessagePop {
    private var pool: SoundPool? = null
    private var soundId = 0
    private var loaded = false
    private var lastPlayMillis: Long? = null

    @Synchronized
    fun play(context: Context) {
        try {
            val app = context.applicationContext
            val audio = app.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
            val nm = app.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            val filter = nm?.currentInterruptionFilter ?: NotificationManager.INTERRUPTION_FILTER_UNKNOWN
            if (!shouldPlayPop(audio.ringerMode, filter)) return
            val now = SystemClock.elapsedRealtime()
            if (popDebounced(now, lastPlayMillis)) return
            lastPlayMillis = now
            val sp = pool ?: SoundPool.Builder()
                .setMaxStreams(1)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                .build()
                .also { created ->
                    pool = created
                    created.setOnLoadCompleteListener { p, id, status ->
                        if (status == 0 && id == soundId) {
                            loaded = true
                            runCatching { p.play(id, 1f, 1f, 1, 0, 1f) }
                        }
                    }
                    soundId = created.load(app, R.raw.message_pop, 1)
                    return
                }
            if (loaded) sp.play(soundId, 1f, 1f, 1, 0, 1f)
        } catch (_: Throwable) {
        }
    }
}
