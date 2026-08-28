package io.github.sirbughunter.agenticwear.voice

import android.content.Context
import android.media.MediaRecorder
import java.io.File
import java.util.UUID

class VoiceRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var output: File? = null

    val isRecording: Boolean get() = recorder != null

    fun start(): File {
        check(recorder == null) { "A recording is already active" }
        val file = File(context.cacheDir, "agentic-wear-${UUID.randomUUID()}.m4a")
        val next = MediaRecorder(context)
        try {
            next.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioChannels(1)
                setAudioSamplingRate(16_000)
                setAudioEncodingBitRate(32_000)
                setMaxDuration(MAX_DURATION_MS)
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
        return file
    }

    fun stop(): File? {
        val active = recorder ?: return null
        recorder = null
        val file = output
        output = null
        return try {
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

    fun cancel() {
        val file = stop()
        file?.delete()
    }

    companion object {
        private const val MAX_DURATION_MS = 60_000
        private const val MAX_FILE_BYTES = 480 * 1_024
        private const val MIN_FILE_BYTES = 1_024
    }
}
