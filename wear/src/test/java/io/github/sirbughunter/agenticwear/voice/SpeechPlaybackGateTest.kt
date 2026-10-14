package io.github.sirbughunter.agenticwear.voice

import org.junit.Assert.*
import org.junit.Test

class SpeechPlaybackGateTest {
    @Test fun pendingSpeechIsNotSuccessfulPlayback() {
        val g = SpeechPlaybackGate(); g.begin("one")
        assertEquals(false, g.finish("one"))
    }
    @Test fun startIsOnlyAcceptedOnceForTheCurrentUtterance() {
        val g = SpeechPlaybackGate(); g.begin("one")
        assertFalse(g.started("old")); assertTrue(g.started("one")); assertFalse(g.started("one"))
        assertEquals(true, g.finish("one")); assertNull(g.finish("one"))
    }
    @Test fun cancelledOrReplacedSpeechCannotStartAnInterruptionMonitor() {
        val g = SpeechPlaybackGate(); g.begin("one"); g.stop()
        assertFalse(g.started("one")); assertNull(g.finish("one"))
        g.begin("two"); assertFalse(g.started("one")); assertNull(g.finish("one"))
        assertTrue(g.started("two"))
    }
    @Test fun automaticInterruptionsRequireAnEnabledControlledEchoCanceller() {
        for (a in listOf(false, true)) for (e in listOf(false, true)) for (c in listOf(false, true))
            assertEquals(a && e && c, safeAutomaticBargeIn(a, e, c))
    }
}
