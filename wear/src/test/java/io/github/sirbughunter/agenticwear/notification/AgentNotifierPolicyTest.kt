package io.github.sirbughunter.agenticwear.notification

import io.github.sirbughunter.agenticwear.model.AlertKind
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
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

    @Test
    fun `complete notification leads with the reply preview`() {
        val t = notificationTexts(AlertKind.COMPLETE, "Finished at 9:41", "Here is the reply")
        assertEquals("Here is the reply", t.contentText)
        assertEquals("Finished at 9:41", t.subText)
        assertEquals("Here is the reply", t.bigText)
    }

    @Test
    fun `permission and error notifications keep summary first`() {
        for (kind in listOf(AlertKind.PERMISSION, AlertKind.ERROR)) {
            val t = notificationTexts(kind, "Summary", "Detail")
            assertEquals("Summary", t.contentText)
            assertEquals("Detail", t.subText)
            assertEquals("Summary\nDetail", t.bigText)
        }
    }

    @Test
    fun `only complete notifications get an open action with a distinct request code`() {
        assertTrue(notificationHasOpenAction(AlertKind.COMPLETE))
        assertFalse(notificationHasOpenAction(AlertKind.PERMISSION))
        assertFalse(notificationHasOpenAction(AlertKind.ERROR))
        assertTrue(openActionRequestCode("evt-1") != "evt-1".hashCode())
    }
}
