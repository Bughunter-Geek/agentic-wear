package io.github.sirbughunter.agenticwear.notification

import android.app.NotificationManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessagePopPolicyTest {
    @Test
    fun duplicateNeverPresents() {
        assertEquals(AlertPresentation.NONE, alertPresentation(false, true, true))
        assertEquals(AlertPresentation.NONE, alertPresentation(false, true, false))
    }

    @Test
    fun suppressedNeverPresents() {
        assertEquals(AlertPresentation.NONE, alertPresentation(true, false, true))
        assertEquals(AlertPresentation.NONE, alertPresentation(true, false, false))
    }

    @Test
    fun foregroundPopsBackgroundNotifies() {
        assertEquals(AlertPresentation.POP, alertPresentation(true, true, true))
        assertEquals(AlertPresentation.NOTIFY, alertPresentation(true, true, false))
    }

    @Test
    fun quietModeGate() {
        val all = NotificationManager.INTERRUPTION_FILTER_ALL
        assertTrue(shouldPlayPop(true, all))
        assertTrue(shouldPlayPop(true, NotificationManager.INTERRUPTION_FILTER_UNKNOWN))
        assertFalse(shouldPlayPop(true, NotificationManager.INTERRUPTION_FILTER_NONE))
        assertFalse(shouldPlayPop(true, NotificationManager.INTERRUPTION_FILTER_PRIORITY))
        assertFalse(shouldPlayPop(true, NotificationManager.INTERRUPTION_FILTER_ALARMS))
        assertFalse(shouldPlayPop(false, all))
        assertFalse(shouldPlayPop(false, NotificationManager.INTERRUPTION_FILTER_UNKNOWN))
        assertFalse(shouldPlayPop(false, NotificationManager.INTERRUPTION_FILTER_NONE))
    }

    @Test
    fun debounce() {
        assertFalse(popDebounced(1_000, null))
        assertTrue(popDebounced(1_200, 1_000))
        assertFalse(popDebounced(1_300, 1_000))
        assertFalse(popDebounced(2_000, 1_000))
    }
}
