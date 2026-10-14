package io.github.sirbughunter.agenticwear.live

import org.junit.Assert.*
import org.junit.Test

class LiveCallDurationTest {
    @Test fun setupIsExcludedAndReconnectKeepsFirstStart() {
        assertNull(liveCallDurationMs(null, null, 30_000))
        assertEquals(0L, liveCallDurationMs(30_000, null, 30_000))
        assertEquals(600_000L, liveCallDurationMs(30_000, null, 630_000))
        assertEquals("10:00", formatLiveCallDuration(600_000))
    }
    @Test fun endFreezesUntilNewCall() {
        assertEquals(125_000L, liveCallDurationMs(30_000, 125_000, 900_000))
        assertEquals("02:05", formatLiveCallDuration(125_000))
        assertEquals(1000L, liveCallDurationMs(900_000, null, 901_000))
        assertEquals("00:00", formatLiveCallDuration(-1))
    }
}
