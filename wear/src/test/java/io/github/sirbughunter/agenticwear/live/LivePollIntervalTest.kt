package io.github.sirbughunter.agenticwear.live

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LivePollIntervalTest {
    @Test fun pollsQuicklyUntilTheFirstMediaConnection() {
        assertEquals(250L, livePollIntervalMs(mediaConnected = false))
    }

    @Test fun settlesToTheSteadyCallCadenceOnceConnected() {
        assertEquals(1_000L, livePollIntervalMs(mediaConnected = true))
    }

    @Test fun startupCadenceIsFasterThanTheCallCadence() {
        assertTrue(livePollIntervalMs(false) < livePollIntervalMs(true))
    }
}
