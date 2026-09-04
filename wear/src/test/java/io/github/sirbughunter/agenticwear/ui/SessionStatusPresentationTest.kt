package io.github.sirbughunter.agenticwear.ui

import io.github.sirbughunter.agenticwear.model.SessionStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class SessionStatusPresentationTest {
    @Test
    fun `reachable unloaded sessions say they are available`() {
        assertEquals("Available", SessionStatus.NOT_LOADED.label)
    }

    @Test
    fun `active and idle sessions use explicit working language`() {
        assertEquals("Working", SessionStatus.ACTIVE.label)
        assertEquals("Ready", SessionStatus.IDLE.label)
    }
}
