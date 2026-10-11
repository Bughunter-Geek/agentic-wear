package io.github.sirbughunter.agenticwear.notification

import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import android.os.SystemClock
import io.github.sirbughunter.agenticwear.R
import io.github.sirbughunter.agenticwear.model.AlertKind

internal const val POP_DEBOUNCE_MILLIS = 300L

/** In-app media feedback: ringer mode is deliberately ignored; Do Not Disturb still mutes it. */
internal fun shouldPlayPop(enabled: Boolean, interruptionFilter: Int): Boolean =
    enabled &&
        (interruptionFilter == NotificationManager.INTERRUPTION_FILTER_ALL ||
            interruptionFilter == NotificationManager.INTERRUPTION_FILTER_UNKNOWN)

internal fun popDebounced(nowMillis: Long, lastPlayMillis: Long?): Boolean =
    lastPlayMillis != null && nowMillis - lastPlayMillis in 0 until POP_DEBOUNCE_MILLIS

enum class AppSound { POP, ERROR }

/** Foreground presentation of an alert: errors get the error sound instead of the pop. */
internal fun alertSound(presentation: AlertPresentation, kind: AlertKind): AppSound? = when (presentation) {
    AlertPresentation.POP -> if (kind == AlertKind.ERROR) AppSound.ERROR else AppSound.POP
    else -> null
}

/** True the first time [key] is seen; remembers the most recent [max] keys. */
internal fun firstErrorSighting(seen: MutableList<String>, key: String, max: Int = 20): Boolean {
    if (key.isBlank() || key in seen) return false
    seen.add(key)
    while (seen.size > max) seen.removeAt(0)
    return true
}

internal object MessagePop {
    private var pool: SoundPool? = null
    private val soundIds = HashMap<AppSound, Int>()
    private val loaded = HashSet<Int>()
    private val queued = HashSet<Int>()
    private var lastPlayMillis: Long? = null
    private val seenErrors = ArrayList<String>()

    /** The first key identifies the error (event/request id); the rest are only registered so other paths don't repeat it. */
    @Synchronized
    fun playErrorOnce(context: Context, enabled: Boolean, key: String, vararg alsoSeen: String) {
        val fresh = firstErrorSighting(seenErrors, key)
        alsoSeen.forEach { firstErrorSighting(seenErrors, it) }
        if (fresh) play(context, enabled, AppSound.ERROR)
    }

    @Synchronized
    fun play(context: Context, enabled: Boolean, sound: AppSound = AppSound.POP) {
        try {
            val app = context.applicationContext
            val nm = app.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            val filter = nm?.currentInterruptionFilter ?: NotificationManager.INTERRUPTION_FILTER_UNKNOWN
            if (!shouldPlayPop(enabled, filter)) return
            val now = SystemClock.elapsedRealtime()
            if (popDebounced(now, lastPlayMillis)) return
            lastPlayMillis = now
            val sp = pool ?: SoundPool.Builder()
                .setMaxStreams(1)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                .build()
                .also { created ->
                    pool = created
                    created.setOnLoadCompleteListener { p, id, status ->
                        synchronized(this) {
                            if (status == 0) {
                                loaded.add(id)
                                if (queued.remove(id)) runCatching { p.play(id, 1f, 1f, 1, 0, 1f) }
                            }
                        }
                    }
                    soundIds[AppSound.POP] = created.load(app, R.raw.message_pop, 1)
                    soundIds[AppSound.ERROR] = created.load(app, R.raw.message_error, 1)
                }
            val id = soundIds[sound] ?: return
            if (id in loaded) sp.play(id, 1f, 1f, 1, 0, 1f) else queued.add(id)
        } catch (_: Throwable) {
        }
    }
}
