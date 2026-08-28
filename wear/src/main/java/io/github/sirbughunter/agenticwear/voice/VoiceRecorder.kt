package io.github.sirbughunter.agenticwear.voice

import android.content.Context
import android.media.MediaRecorder
import java.io.File
import java.util.UUID

class VoiceRecorder(private val context: Context) {
    private val recorderLock = Any()
    private var recorder: MediaRecorder? = null
    private var output: File? = null

    val isRecording: Boolean get() = synchronized(recorderLock) { recorder != null }

    fun start(): File = synchronized(recorderLock) {
        check(recorder == null) { "A recording is already active" }
        val file = File(context.cacheDir, "agentic-wear-${UUID.randomUUID()}.aac")
        val next = MediaRecorder(context)
        try {
            next.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                // ADTS is frame-based and does not need an MP4 index to be finalized at stop time.
                setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioChannels(1)
                setAudioSamplingRate(16_000)
                setAudioEncodingBitRate(32_000)
                setMaxDuration(RECORDER_SAFETY_DURATION_MS)
                setMaxFileSize(MAX_FILE_BYTES.toLong())
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
        } catch (error: Throwable) {
            runCatching { next.reset() }
            next.release()
            file.delete()
            throw error
        }
        output = file
        recorder = next
        file
    }

    fun stop(): File? = synchronized(recorderLock) {
        val active = recorder ?: return@synchronized null
        recorder = null
        val file = output
        output = null
        try {
            active.stop()
            file?.takeIf { it.exists() && it.length() > MIN_FILE_BYTES }
        } catch (_: RuntimeException) {
            file?.delete()
            null
        } finally {
            runCatching { active.reset() }
            active.release()
        }
    }

    fun maxAmplitude(): Int = synchronized(recorderLock) {
        runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0)
    }

    fun cancel() {
        val file = stop()
        file?.delete()
    }

    companion object {
        private const val RECORDER_SAFETY_DURATION_MS = 245_000
        private const val MAX_FILE_BYTES = 1_250_000
        private const val MIN_FILE_BYTES = 1_024
    }
}
