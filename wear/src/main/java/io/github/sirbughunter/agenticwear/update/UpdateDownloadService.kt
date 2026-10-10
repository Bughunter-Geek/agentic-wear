package io.github.sirbughunter.agenticwear.update

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import io.github.sirbughunter.agenticwear.BuildConfig
import io.github.sirbughunter.agenticwear.MainActivity
import io.github.sirbughunter.agenticwear.R
import java.io.File
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow

internal data class UpdateDownloadSnapshot(val update: UpdateUiState = UpdateUiState(), val apk: File? = null)

/** A user-started, bounded transfer. Activity disappearance never owns its cancellation. */
class UpdateDownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var manager: AppUpdateManager
    private var job: Job? = null
    private var timeout: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null
    @Volatile private var terminal = false

    override fun onCreate() {
        super.onCreate(); manager = AppUpdateManager(this)
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "App update download", NotificationManager.IMPORTANCE_LOW))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (BuildConfig.DEBUG) android.util.Log.i("UpdateDownloadQa", "command=" + (intent?.action ?: "begin"))
        if (intent?.action == CANCEL) { finish("Update cancelled · tap to retry", discardPartial = true); return START_NOT_STICKY }
        if (job?.isActive == true) return START_NOT_STICKY
        val fixture = BuildConfig.DEBUG && intent?.getBooleanExtra("qa_offline", false) == true
        val release = if (fixture) AppRelease(999, "Offline download QA", "", "0".repeat(64), 1) else manager.cachedRelease()
        if (release == null || (!fixture && (release.versionCode != intent?.getIntExtra("version", -1) || release.sha256 != intent.getStringExtra("sha")))) {
            finish("Update changed or expired · check for updates again"); return START_NOT_STICKY
        }
        terminal = false
        snapshot.value = UpdateDownloadSnapshot(UpdateUiState(true, UpdateStage.DOWNLOADING, release))
        try {
            notifyProgress(0, foreground = true)
            wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:update").apply {
                setReferenceCounted(false); acquire(LIMIT_MS + 5_000)
            }
        } catch (error: Exception) { finish("Could not keep the update active · retry from the app"); return START_NOT_STICKY }
        timeout = scope.launch { delay(LIMIT_MS); finish("Download timed out · tap to resume") }
        job = scope.launch {
            try {
                val apk = if (fixture) {
                    repeat(120) { delay(500); progress(it * 100 / 120) }
                    throw java.io.IOException("Offline QA complete · no APK downloaded")
                } else withContext(Dispatchers.IO) { manager.download(release, ::progress) }
                if (!terminal) {
                    terminal = true
                    snapshot.value = UpdateDownloadSnapshot(UpdateUiState(true, UpdateStage.READY, release, 100, "Tap to open the system installer"), apk)
                    releaseResources()
                    getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification("Update ready · open Agentic Wear", ongoing = false))
                    stopSelf()
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { if (!terminal) finish(error.message ?: "Download interrupted · tap to resume") }
        }
        return START_NOT_STICKY
    }

    private fun progress(value: Int) { scope.launch {
        if (terminal || snapshot.value.update.progress == value) return@launch
        snapshot.value = snapshot.value.copy(update = snapshot.value.update.copy(progress = value))
        notifyProgress(value)
    } }
    private fun notifyProgress(value: Int, foreground: Boolean = false) {
        val notification = notification("Downloading update · $value%", true)
        if (foreground) ServiceCompat.startForeground(this, NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification)
    }
    private fun notification(text: String, ongoing: Boolean) = NotificationCompat.Builder(this, CHANNEL)
        .setSmallIcon(R.drawable.ic_stat_agent).setContentTitle("Agentic Wear update").setContentText(text)
        .setOnlyAlertOnce(true).setOngoing(ongoing)
        .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        .apply { if (ongoing) addAction(0, "Cancel", PendingIntent.getService(this@UpdateDownloadService, 1,
            Intent(this@UpdateDownloadService, UpdateDownloadService::class.java).setAction(CANCEL), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)) }
        .build()

    private fun finish(message: String, discardPartial: Boolean = false) {
        terminal = true
        manager.cancelDownload(discardPartial); job?.cancel()
        snapshot.value = UpdateDownloadSnapshot(snapshot.value.update.copy(enabled = true, stage = UpdateStage.ERROR, message = message))
        releaseResources(); stopSelf()
    }
    private fun releaseResources() {
        timeout?.cancel(); timeout = null
        wakeLock?.takeIf { it.isHeld }?.release(); wakeLock = null
        if (BuildConfig.DEBUG) android.util.Log.i("UpdateDownloadQa", "resources_released")
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    }
    override fun onTimeout(startId: Int, fgsType: Int) { finish("Android stopped the download · tap to resume") }
    override fun onDestroy() {
        manager.cancelDownload(); job?.cancel(); scope.cancel(); releaseResources()
        if (!terminal) snapshot.value = UpdateDownloadSnapshot(snapshot.value.update.copy(stage = UpdateStage.ERROR, message = "Download interrupted · tap to resume"))
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL = "app_update_download"
        private const val NOTIFICATION = 4103
        private const val CANCEL = "cancel_update_download"
        private const val LIMIT_MS = 10 * 60_000L
        internal val snapshot = MutableStateFlow(UpdateDownloadSnapshot())
        fun begin(context: Context, release: AppRelease) = ContextCompat.startForegroundService(context,
            Intent(context, UpdateDownloadService::class.java).putExtra("version", release.versionCode).putExtra("sha", release.sha256))
        fun cancel(context: Context) = context.startService(Intent(context, UpdateDownloadService::class.java).setAction(CANCEL))
    }
}
