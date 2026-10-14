package io.github.sirbughunter.agenticwear.live

import org.junit.Assert.assertEquals
import org.junit.Test

class CallingToneTest {
    @Test fun acceptanceAndTeardownStopPlaybackOnlyOnce() {
        val events = mutableListOf<String>()
        val tone = CallingTone({ events.add("start") }, { events.add("stop") })
        tone.start(); tone.start(); tone.stop(); tone.stop()
        assertEquals(listOf("start", "stop"), events)
    }
    @Test fun cancellationBeforeStartupPreventsLatePlayback() {
        val events = mutableListOf<String>()
        val tone = CallingTone({ events.add("start") }, { events.add("stop") })
        tone.stop(); tone.start()
        assertEquals(emptyList<String>(), events)
    }
    @Test fun nextCallHasIndependentPlayback() {
        val events = mutableListOf<String>()
        fun call() = CallingTone({ events.add("start") }, { events.add("stop") })
        val first = call(); first.start(); first.stop(); first.start()
        val second = call(); second.start(); second.stop()
        assertEquals(listOf("start", "stop", "start", "stop"), events)
    }
}
