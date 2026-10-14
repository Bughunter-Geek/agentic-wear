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
    private var initializationFailed = false
    private val playback = SpeechPlaybackGate()
    private var onStarted: (() -> Unit)? = null
    private var startTimeout: Runnable? = null
    private var queued: (() -> Unit)? = null
    private var onDone: (() -> Unit)? = null
    private var onError: (() -> Unit)? = null
    private var utteranceCounter = 0

    init {
        tts = TextToSpeech(context.applicationContext) { status ->
            main.post {
                ready = status == TextToSpeech.SUCCESS
                initializationFailed = !ready
                val engine = tts
                if (ready && engine != null) {
                    engine.setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build(),
                    )
                    engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(utteranceId: String?) {
                            main.post {
                                if (playback.started(utteranceId)) {
                                    startTimeout?.let(main::removeCallbacks); startTimeout = null
                                    onStarted?.also { onStarted = null }?.invoke()
                                }
                            }
                        }
                        override fun onDone(utteranceId: String?) { main.post { finish(utteranceId, error = false) } }
                        @Deprecated("Deprecated in Java")
                        override fun onError(utteranceId: String?) { main.post { finish(utteranceId, error = true) } }
                        override fun onError(utteranceId: String?, errorCode: Int) { main.post { finish(utteranceId, error = true) } }
                    })
                    queued?.also { queued = null }?.invoke()
                } else {
                    queued = null
                    finish(currentUtterance, error = true)
                }
            }
        }
    }

    private var currentUtterance: String? = null

    private fun finish(utteranceId: String?, error: Boolean) {
        val played = playback.finish(utteranceId) ?: return
        currentUtterance = null
        queued = null
        val callback = if (error || !played) onError else onDone
        clearCallbacks()
        callback?.invoke()
    }

    private fun clearCallbacks() {
        startTimeout?.let(main::removeCallbacks); startTimeout = null
        onDone = null; onError = null; onStarted = null
    }

    /** Speaks [text]; [done] runs when finished, [failed] if speech cannot run. A newer call replaces the old one silently. */
    fun speak(text: String, done: () -> Unit, failed: () -> Unit, started: () -> Unit = {}) {
        stop()
        val id = "reply-${++utteranceCounter}"
        currentUtterance = id
        playback.begin(id)
        onDone = done
        onError = failed
        onStarted = started
        if (initializationFailed) { finish(id, error = true); return }
        // A missing engine/voice or stalled synthesis must not look like audible speech forever.
        startTimeout = Runnable { finish(id, error = true) }.also { main.postDelayed(it, 10_000L) }
        val start = {
            try {
                val result = tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
                if (result != TextToSpeech.SUCCESS) finish(id, error = true)
            } catch (_: RuntimeException) { finish(id, error = true) }
        }
        if (ready) start() else queued = start
    }

    /** Stops speech without calling back. */
    fun stop() {
        queued = null
        currentUtterance = null
        playback.stop()
        clearCallbacks()
        runCatching { tts?.stop() }
    }

    fun shutdown() {
        stop()
        runCatching { tts?.shutdown() }
        tts = null
        ready = false
        initializationFailed = true
    }
}
