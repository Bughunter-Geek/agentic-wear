package io.github.sirbughunter.agenticwear.live

/** One call owns one tone. Acceptance or teardown permanently prevents a late restart. */
internal class CallingTone(private val startPlayback: () -> Unit, private val stopPlayback: () -> Unit) {
    private var started = false
    private var finished = false
    fun start() {
        if (started || finished) return
        started = true
        startPlayback()
    }
    fun stop() {
        if (finished) return
        finished = true
        if (started) stopPlayback()
    }
}
