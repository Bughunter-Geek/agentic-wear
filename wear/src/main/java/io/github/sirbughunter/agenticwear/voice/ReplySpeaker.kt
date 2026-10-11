package io.github.sirbughunter.agenticwear.voice

import android.content.Context
import android.media.AudioAttributes
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener

/** One-shot system text-to-speech on media volume; call [shutdown] when done. */
class ReplySpeaker(context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var ready = false
    private var queued: (() -> Unit)? = null
    private var onDone: (() -> Unit)? = null
    private var onError: (() -> Unit)? = null
    private var utteranceCounter = 0

    init {
        tts = TextToSpeech(context.applicationContext) { status ->
            main.post {
                ready = status == TextToSpeech.SUCCESS
                val engine = tts
                if (ready && engine != null) {
                    engine.setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build(),
                    )
                    engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(utteranceId: String?) = Unit
                        override fun onDone(utteranceId: String?) { main.post { finish(utteranceId, error = false) } }
                        @Deprecated("Deprecated in Java")
                        override fun onError(utteranceId: String?) { main.post { finish(utteranceId, error = true) } }
                        override fun onError(utteranceId: String?, errorCode: Int) { main.post { finish(utteranceId, error = true) } }
                    })
                    queued?.also { queued = null }?.invoke()
                } else {
                    queued = null
                    onError?.also { clearCallbacks() }?.invoke()
                }
            }
        }
    }

    private var currentUtterance: String? = null

    private fun finish(utteranceId: String?, error: Boolean) {
        if (utteranceId != currentUtterance) return
        currentUtterance = null
        val callback = if (error) onError else onDone
        clearCallbacks()
        callback?.invoke()
    }

    private fun clearCallbacks() { onDone = null; onError = null }

    /** Speaks [text]; [done] runs when finished, [failed] if speech cannot run. A newer call replaces the old one silently. */
    fun speak(text: String, done: () -> Unit, failed: () -> Unit) {
        stop()
        onDone = done
        onError = failed
        val start = {
            val id = "reply-${++utteranceCounter}"
            currentUtterance = id
            val result = tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
            if (result != TextToSpeech.SUCCESS) { currentUtterance = null; onError?.also { clearCallbacks() }?.invoke() }
        }
        if (ready) start() else queued = start
    }

    /** Stops speech without calling back. */
    fun stop() {
        queued = null
        currentUtterance = null
        clearCallbacks()
        runCatching { tts?.stop() }
    }

    fun shutdown() {
        stop()
        runCatching { tts?.shutdown() }
        tts = null
    }
}
