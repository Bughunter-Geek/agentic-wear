package io.github.sirbughunter.agenticwear.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

class DeviceSpeechController(
    context: Context,
    private val onResult: (String) -> Unit,
    private val onFailure: (String) -> Unit,
    private val onVoiceLevel: (Float) -> Unit,
) : RecognitionListener {
    private val recognizer = SpeechRecognizer.createSpeechRecognizer(context).also {
        it.setRecognitionListener(this)
    }
    private var listening = false

    fun start() {
        if (listening) return
        listening = true
        recognizer.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1),
        )
    }

    fun stop() {
        if (listening) recognizer.stopListening()
    }

    fun cancel() {
        if (listening) recognizer.cancel()
        listening = false
        onVoiceLevel(0f)
    }

    fun destroy() {
        listening = false
        recognizer.destroy()
    }

    override fun onResults(results: Bundle) {
        listening = false
        onVoiceLevel(0f)
        val text = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull()
            .orEmpty()
            .trim()
        if (text.isBlank()) onFailure("No speech was recognized") else onResult(text)
    }

    override fun onError(error: Int) {
        listening = false
        onVoiceLevel(0f)
        if (error != SpeechRecognizer.ERROR_CLIENT && error != SpeechRecognizer.ERROR_NO_MATCH) {
            onFailure("Device speech recognition stopped ($error)")
        } else if (error == SpeechRecognizer.ERROR_NO_MATCH) {
            onFailure("No speech was recognized")
        }
    }

    override fun onReadyForSpeech(params: Bundle?) = Unit
    override fun onBeginningOfSpeech() = Unit
    override fun onRmsChanged(rmsdB: Float) = onVoiceLevel(rmsVoiceActivityLevel(rmsdB))
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEndOfSpeech() = onVoiceLevel(0f)
    override fun onPartialResults(partialResults: Bundle?) = Unit
    override fun onEvent(eventType: Int, params: Bundle?) = Unit
}
