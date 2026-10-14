package io.github.sirbughunter.agenticwear.voice

/** Ignores late TTS callbacks and distinguishes queued speech from actual playback. */
internal class SpeechPlaybackGate {
    private var current: String? = null
    private var audible = false
    fun begin(id: String) { current = id; audible = false }
    fun started(id: String?): Boolean {
        if (current == null || current != id || audible) return false
        audible = true
        return true
    }
    /** null means stale; false means completion was reported without playback starting. */
    fun finish(id: String?): Boolean? {
        if (current == null || current != id) return null
        val played = audible
        stop()
        return played
    }
    fun stop() { current = null; audible = false }
}

internal fun safeAutomaticBargeIn(available: Boolean, enabled: Boolean, controlled: Boolean) =
    available && enabled && controlled
