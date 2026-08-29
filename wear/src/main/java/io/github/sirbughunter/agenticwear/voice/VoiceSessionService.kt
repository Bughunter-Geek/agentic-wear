package io.github.sirbughunter.agenticwear.voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import io.github.sirbughunter.agenticwear.MainActivity
import io.github.sirbughunter.agenticwear.R
import io.github.sirbughunter.agenticwear.data.AgenticWearRepository
import io.github.sirbughunter.agenticwear.data.AppPreferences
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

enum class VoiceSessionPhase { IDLE, RECORDING, TRANSCRIBING, ERROR }

data class VoiceSessionSnapshot(
    val phase: VoiceSessionPhase = VoiceSessionPhase.IDLE,
    val voiceLevel: Float = 0f,
    val transcriptionStartedAtElapsedRealtime: Long? = null,
    val error: String? = null,
)

/**
 * Owns bridge-backed voice capture independently from MainActivity.
 *
 * Wear OS can navigate to the watch face after a wrist gesture. Recording must therefore be
 * attached to a foreground service, not the visibility lifecycle of the activity that started it.
 */
class VoiceSessionService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var recorder: VoiceRecorder
    private lateinit var repository: AgenticWearRepository
    private lateinit var preferences: AppPreferences
    private var voiceMonitorJob: Job? = null
    private var timeoutJob: Job? = null
    private var transcriptionJob: Job? = null
    private var activeThreadId: String? = null
    private var notifyAfterMillis: Long? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var stopping = false

    override fun onCreate() {
        super.onCreate()
        recorder = VoiceRecorder(this)
        repository = AgenticWearRepository(this)
        preferences = AppPreferences(this)
        createNotificationChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_BEGIN -> begin(intent)
            ACTION_FINISH -> finishAndTranscribe()
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        voiceMonitorJob?.cancel()
        timeoutJob?.cancel()
        transcriptionJob?.cancel()
        if (recorder.isRecording) recorder.cancel()
        releaseWakeLock()
        if (!stopping) _sessionState.value = VoiceSessionSnapshot()
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun begin(intent: Intent) {
        if (recorder.isRecording || _sessionState.value.phase == VoiceSessionPhase.TRANSCRIBING) return
        activeThreadId = intent.getStringExtra(EXTRA_THREAD_ID)
        notifyAfterMillis = intent.takeIf { it.hasExtra(EXTRA_NOTIFY_AFTER_MILLIS) }
            ?.getLongExtra(EXTRA_NOTIFY_AFTER_MILLIS, 0L)
        stopping = false

        runCatching {
            promoteToForeground(transcribing = false)
            acquireWakeLock()
            recorder.start()
        }.onFailure { error ->
            fail(error.message ?: "Could not start the microphone")
            return
        }

        _sessionState.value = VoiceSessionSnapshot(phase = VoiceSessionPhase.RECORDING)
        voiceMonitorJob = serviceScope.launch(Dispatchers.Default) {
            while (isActive && recorder.isRecording) {
                _sessionState.value = VoiceSessionSnapshot(
                    phase = VoiceSessionPhase.RECORDING,
                    voiceLevel = voiceActivityLevel(recorder.maxAmplitude()),
                )
                delay(VOICE_LEVEL_INTERVAL_MS)
            }
        }
        timeoutJob = serviceScope.launch {
            delay(MAX_RECORDING_DURATION_MS)
            if (recorder.isRecording) finishAndTranscribe()
        }
    }

    private fun finishAndTranscribe() {
        if (!recorder.isRecording) return
        voiceMonitorJob?.cancel()
        voiceMonitorJob = null
        timeoutJob?.cancel()
        timeoutJob = null
        val audio = recorder.stop()
        if (audio == null) {
            fail("I didn't catch enough audio. Tap and try again.")
            return
        }

        val startedAt = SystemClock.elapsedRealtime()
        _sessionState.value = VoiceSessionSnapshot(
            phase = VoiceSessionPhase.TRANSCRIBING,
            transcriptionStartedAtElapsedRealtime = startedAt,
        )
        promoteToForeground(transcribing = true)
        transcriptionJob = serviceScope.launch(Dispatchers.IO) {
            try {
                repository.transcribe(
                    audioFile = audio,
                    threadId = activeThreadId,
                    notifyAfterMillis = notifyAfterMillis,
                )
                finishService()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                fail(error.message ?: "Transcription failed")
            }
        }
    }

    private fun fail(message: String) {
        recorder.cancel()
        preferences.pending = false
        preferences.lastError = message
        _sessionState.value = VoiceSessionSnapshot(
            phase = VoiceSessionPhase.ERROR,
            error = message,
        )
        sendBroadcast(Intent(AgenticWearRepository.ACTION_STATE_CHANGED).setPackage(packageName))
        finishService(resetState = false)
    }

    private fun finishService(resetState: Boolean = true) {
        stopping = true
        if (resetState) _sessionState.value = VoiceSessionSnapshot()
        releaseWakeLock()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun promoteToForeground(transcribing: Boolean) {
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(transcribing),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
        )
    }

    private fun buildNotification(transcribing: Boolean): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_agent)
            .setContentTitle(if (transcribing) "Transcribing voice prompt" else "Listening for your prompt")
            .setContentText(if (transcribing) "Agentic Wear is preparing the transcript" else "Recording continues if you leave the app")
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(openIntent)

        if (Build.VERSION.SDK_INT >= 36) {
            builder
                .setRequestPromotedOngoing(true)
                .setShortCriticalText(if (transcribing) "TXT" else "REC")
        }

        if (!transcribing) {
            val finishIntent = PendingIntent.getService(
                this,
                1,
                Intent(this, VoiceSessionService::class.java).setAction(ACTION_FINISH),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            builder.addAction(0, "Transcribe", finishIntent)
        }
        OngoingActivity.Builder(this, NOTIFICATION_ID, builder)
            .setStaticIcon(R.drawable.ic_stat_agent)
            .setTouchIntent(openIntent)
            .setTitle(if (transcribing) "Transcribing" else "Recording")
            .setStatus(Status.Builder().addTemplate(if (transcribing) "Preparing transcript" else "Listening").build())
            .build()
            .apply(this)
        return builder.build()
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val powerManager = getSystemService(PowerManager::class.java)
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "$packageName:voice-session",
        ).apply {
            setReferenceCounted(false)
            acquire(VOICE_SESSION_WAKE_LOCK_LIMIT_MS)
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
    }

    companion object {
        private const val ACTION_BEGIN = "io.github.sirbughunter.agenticwear.voice.BEGIN"
        private const val ACTION_FINISH = "io.github.sirbughunter.agenticwear.voice.FINISH"
        private const val EXTRA_THREAD_ID = "thread_id"
        private const val EXTRA_NOTIFY_AFTER_MILLIS = "notify_after_millis"
        private const val CHANNEL_ID = "voice_session_v1"
        private const val NOTIFICATION_ID = 7_301
        private const val VOICE_LEVEL_INTERVAL_MS = 80L
        private const val MAX_RECORDING_DURATION_MS = 4L * 60L * 1_000L
        private const val VOICE_SESSION_WAKE_LOCK_LIMIT_MS = MAX_RECORDING_DURATION_MS + 30_000L

        private val _sessionState = MutableStateFlow(VoiceSessionSnapshot())
        val sessionState: StateFlow<VoiceSessionSnapshot> = _sessionState.asStateFlow()

        fun createNotificationChannel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Voice recording",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "Shows while Agentic Wear records or transcribes a voice prompt"
                    setSound(null, null)
                    enableVibration(false)
                },
            )
        }

        fun begin(context: Context, threadId: String?, notifyAfterMillis: Long) {
            val intent = Intent(context, VoiceSessionService::class.java)
                .setAction(ACTION_BEGIN)
                .putExtra(EXTRA_THREAD_ID, threadId)
                .putExtra(EXTRA_NOTIFY_AFTER_MILLIS, notifyAfterMillis)
            ContextCompat.startForegroundService(context, intent)
        }

        fun finish(context: Context) {
            context.startService(Intent(context, VoiceSessionService::class.java).setAction(ACTION_FINISH))
        }

        fun cancel(context: Context) {
            _sessionState.value = VoiceSessionSnapshot()
            context.stopService(Intent(context, VoiceSessionService::class.java))
        }
    }
}
