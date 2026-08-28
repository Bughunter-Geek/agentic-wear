package io.github.sirbughunter.agenticwear.notification

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentNotifierPolicyTest {
    @Test
    fun `every agent alert uses one continuous one second vibration`() {
        assertArrayEquals(longArrayOf(0, 1_000), alertVibrationPattern())
    }

    @Test
    fun `foreground sync alerts only for work completed after the app became visible`() {
        val foregroundStartedAt = 10_000L
        assertFalse(shouldPostAlertNotification(true, 9_999L, foregroundStartedAt))
        assertTrue(shouldPostAlertNotification(true, 10_000L, foregroundStartedAt))
        assertTrue(shouldPostAlertNotification(true, 10_001L, foregroundStartedAt))
    }

    @Test
    fun `background delivery remains eligible without a foreground cutoff`() {
        assertTrue(shouldPostAlertNotification(true, 1L, null))
        assertFalse(shouldPostAlertNotification(false, Long.MAX_VALUE, null))
    }
}
