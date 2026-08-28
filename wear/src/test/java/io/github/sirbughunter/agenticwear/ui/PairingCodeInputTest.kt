package io.github.sirbughunter.agenticwear.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class PairingCodeInputTest {
    @Test
    fun preservesOptionalDashWithoutReorderingCharacters() {
        assertEquals("VNXD-8RYB", sanitizePairingCodeInput("vnxd-8ryb"))
        assertEquals("VNXD8RYB", sanitizePairingCodeInput("vnxd8ryb"))
        assertEquals("VNXD8RYB", normalizePairingCodeInput("VNXD-8RYB"))
    }

    @Test
    fun filtersUnsupportedInputAndBoundsTheCode() {
        assertEquals("ABCD-2345", sanitizePairingCodeInput("abcd-2345-extra"))
        assertEquals("ABCD2345", sanitizePairingCodeInput("a b c d 2 3 4 5"))
        assertEquals("ABCD2345", sanitizePairingCodeInput("AB-CD-2345"))
    }

    @Test
    fun extractsAValidCodeFromClipboardOrIntentText() {
        assertEquals("VNXD-8RYB", extractPairingCode("Pairing code: VNXD-8RYB\nExpires in 10 minutes"))
        assertEquals("VNXD8RYB", extractPairingCode("VNXD8RYB"))
        assertEquals(null, extractPairingCode("not a code"))
    }
}
