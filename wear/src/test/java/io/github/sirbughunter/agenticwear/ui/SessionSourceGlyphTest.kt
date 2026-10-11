package io.github.sirbughunter.agenticwear.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class SessionSourceGlyphTest {
    @Test
    fun `source maps to row glyph`() {
        assertEquals(SessionSourceGlyph.MAC, sessionSourceGlyph(null))
        assertEquals(SessionSourceGlyph.MAC, sessionSourceGlyph("automation"))
        assertEquals(SessionSourceGlyph.CLOUD, sessionSourceGlyph("cloud"))
        assertEquals(SessionSourceGlyph.DOT, sessionSourceGlyph("dot"))
    }
}
