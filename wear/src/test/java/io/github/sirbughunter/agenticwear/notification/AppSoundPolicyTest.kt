package io.github.sirbughunter.agenticwear.notification

import io.github.sirbughunter.agenticwear.model.AlertKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppSoundPolicyTest {
    @Test
    fun `foreground picks pop or error, everything else is silent`() {
        assertEquals(AppSound.POP, alertSound(AlertPresentation.POP, AlertKind.COMPLETE))
        assertEquals(AppSound.POP, alertSound(AlertPresentation.POP, AlertKind.QUESTION))
        assertEquals(AppSound.ERROR, alertSound(AlertPresentation.POP, AlertKind.ERROR))
        assertNull(alertSound(AlertPresentation.NOTIFY, AlertKind.ERROR))
        assertNull(alertSound(AlertPresentation.NONE, AlertKind.ERROR))
    }

    @Test
    fun `an error plays once and the seen list is bounded`() {
        val seen = mutableListOf<String>()
        assertTrue(firstErrorSighting(seen, "e1"))
        assertFalse(firstErrorSighting(seen, "e1"))
        assertFalse(firstErrorSighting(seen, " "))
        for (i in 2..30) firstErrorSighting(seen, "e$i")
        assertEquals(20, seen.size)
        assertTrue(firstErrorSighting(seen, "e1"))
    }
}
