package io.github.sirbughunter.agenticwear.notification

import org.junit.Assert.assertArrayEquals
import org.junit.Test

class AgentNotifierPolicyTest {
    @Test
    fun `every agent alert uses one continuous one second vibration`() {
        assertArrayEquals(longArrayOf(0, 1_000), alertVibrationPattern())
    }
}
