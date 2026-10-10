package io.github.sirbughunter.agenticwear.voice
import android.os.SystemClock
import android.util.Log

object VoiceLatency {
    private var stopAt: Long? = null
    private var readyAt: Long? = null
    private var previewLogged = false
    @Synchronized fun start(at: Long) { stopAt = at; readyAt = null; previewLogged = false }
    fun duration(stage: String, start: Long) { Log.i("AgenticWearTiming", "stage=$stage durationMs=${SystemClock.elapsedRealtime() - start}") }
    @Synchronized fun ready() {
        if (stopAt == null || readyAt != null) return
        readyAt = SystemClock.elapsedRealtime()
        Log.i("AgenticWearTiming", "stage=result_ready stopToReadyMs=${readyAt!! - stopAt!!}")
    }
    @Synchronized fun preview() {
        val start = stopAt ?: return
        val ready = readyAt ?: return
        if (previewLogged) return
        previewLogged = true
        val now = SystemClock.elapsedRealtime()
        Log.i("AgenticWearTiming", "stage=preview stopToPreviewMs=${now - start} readyToPreviewMs=${now - ready}")
    }
}
