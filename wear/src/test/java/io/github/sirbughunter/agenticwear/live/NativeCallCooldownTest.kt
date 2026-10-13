package io.github.sirbughunter.agenticwear.live

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeCallCooldownTest {
    @Test fun noPreviousCallDoesNotBlockStartup() { assertEquals(0L, nativeCallCooldownRemainingMs(null, 100)) }
    @Test fun immediateAndShortGapRestartsRemainBlocked() {
        assertEquals(20_000L, nativeCallCooldownRemainingMs(100L, 100L))
        assertEquals(15_000L, nativeCallCooldownRemainingMs(100L, 5100L))
        assertEquals(10_000L, nativeCallCooldownRemainingMs(100L, 10100L))
    }
    @Test fun cooldownUsesElapsedTimeAndExpiresAtTheExactBoundary() {
        assertEquals(1L, nativeCallCooldownRemainingMs(100L, 20099L))
        assertEquals(0L, nativeCallCooldownRemainingMs(100L, 20100L))
        assertEquals(0L, nativeCallCooldownRemainingMs(100L, 30100L))
    }
    @Test fun rebootOrInvalidStoredTimestampDoesNotCreateAStuckCountdown() {
        assertEquals(0L, nativeCallCooldownRemainingMs(50000L, 100L))
        assertEquals(0L, nativeCallCooldownRemainingMs(-1L, 100L))
    }
    @Test fun countdownRoundsUpAndNeverClaimsReadyBeforeExpiry() {
        assertEquals(20, nativeCallCooldownSeconds(20000))
        assertEquals(10, nativeCallCooldownSeconds(9999))
        assertEquals(1, nativeCallCooldownSeconds(1))
        assertEquals(0, nativeCallCooldownSeconds(0))
    }
}
