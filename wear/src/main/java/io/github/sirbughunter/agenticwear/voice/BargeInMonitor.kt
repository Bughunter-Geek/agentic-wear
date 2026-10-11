package io.github.sirbughunter.agenticwear.voice

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import kotlin.math.abs

/** Pure: true once the level stays at or above [LOOP_SPEECH_LEVEL] for [LOOP_BARGE_IN_MS] without a dip. */
class BargeInDetector {
    private var loudSince: Long? = null
    fun update(level: Float, nowMs: Long): Boolean {
        if (level < LOOP_SPEECH_LEVEL) { loudSince = null; return false }
        val since = loudSince ?: nowMs.also { loudSince = it }
        return nowMs - since >= LOOP_BARGE_IN_MS
    }
}

/**
 * Watches the mic level while the reply is being spoken. Uses the VOICE_COMMUNICATION source with the
 * platform echo canceller and noise suppressor when available, so the assistant's own voice is mostly
 * removed. Blocking: run [run] on a background thread; cancel its coroutine (or call [stop]) to release the mic.
 */
class BargeInMonitor {
    @Volatile private var stopped = false
    fun stop() { stopped = true }

    @SuppressLint("MissingPermission")
    fun run(onLevel: (Float) -> Unit): Boolean {
        val rate = 16_000
        val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) return false
        val record = runCatching {
            AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, rate, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, min * 2)
        }.getOrNull() ?: return false
        if (record.state != AudioRecord.STATE_INITIALIZED) { record.release(); return false }
        val aec = runCatching { if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(record.audioSessionId)?.also { it.enabled = true } else null }.getOrNull()
        val ns = runCatching { if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(record.audioSessionId)?.also { it.enabled = true } else null }.getOrNull()
        return try {
            record.startRecording()
            val buffer = ShortArray(rate / 10)
            while (!stopped) {
                val n = record.read(buffer, 0, buffer.size)
                if (n <= 0) return false
                var peak = 0
                for (i in 0 until n) peak = maxOf(peak, abs(buffer[i].toInt()))
                onLevel(voiceActivityLevel(peak))
            }
            true
        } catch (_: Exception) {
            false
        } finally {
            runCatching { record.stop() }
            aec?.release(); ns?.release()
            record.release()
        }
    }
}
