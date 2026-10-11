package io.github.sirbughunter.agenticwear.notification

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class NotificationMarkdownTest {
    private fun MdText.covered(style: MdStyle): List<String> =
        spans.filter { it.style == style }.map { text.substring(it.start, it.end) }

    @Test
    fun `inline markup is removed and spans are produced`() {
        val m = markdownToMdText("This is **bold**, *italic*, ***both***, `code` and ~~gone~~.")
        assertEquals("This is bold, italic, both, code and gone.", m.text)
        assertEquals(listOf("bold", "both"), m.covered(MdStyle.BOLD))
        assertEquals(listOf("italic", "both"), m.covered(MdStyle.ITALIC))
        assertEquals(listOf("code"), m.covered(MdStyle.CODE))
        assertEquals(listOf("gone"), m.covered(MdStyle.STRIKE))
    }

    @Test
    fun `no markdown syntax survives`() {
        val m = markdownToMdText(
            "# Title\n\nSee [the docs](https://example.com) and ![diagram](x.png).\n\n- one\n- two\n\n1. first\n2) second\n\n> quoted\n\n---\n\n```kotlin\nval a = 1\n```",
        )
        for (marker in listOf("**", "`", "#", "[", "](", "https://", "```", "---")) {
            assertFalse("contains $marker: ${m.text}", m.text.contains(marker))
        }
        assertEquals(
            "Title\n\nSee the docs and diagram.\n\n• one\n• two\n\n1. first\n2. second\n\n│ quoted\n\nval a = 1",
            m.text,
        )
    }

    @Test
    fun `headings are bold, quotes italic, code fences monospace`() {
        val m = markdownToMdText("## Head\n> note\n```\nx = 1\n```")
        assertEquals("Head\n│ note\nx = 1", m.text)
        assertEquals(listOf("Head"), m.covered(MdStyle.BOLD))
        assertEquals(listOf("note"), m.covered(MdStyle.ITALIC))
        assertEquals(listOf("x = 1"), m.covered(MdStyle.CODE))
    }

    @Test
    fun `dangling markers from truncated previews are dropped`() {
        assertEquals("Done and then", markdownToMdText("Done and then **").text)
        assertEquals("Run the thing", markdownToMdText("Run the `thing").text)
        assertEquals("Read this", markdownToMdText("Read *this").text)
        assertEquals("Open docs", markdownToMdText("Open [docs](https://exam").text)
        assertEquals("Almost bold", markdownToMdText("**Almost bold").text)
    }

    @Test
    fun `ordinary punctuation and snake case stay`() {
        assertEquals("2 * 3 = 6 in snake_case", markdownToMdText("2 * 3 = 6 in snake_case").text)
        assertEquals("a*b", markdownToMdText("a\\*b").text)
    }

    @Test
    fun `plain text and blank input are safe`() {
        assertEquals("", markdownToMdText("").text)
        assertEquals("", markdownToMdText("  \n ").text)
        assertEquals("hello", markdownToMdText("hello").text)
        assertEquals("a\n\nb", markdownToMdText("a\n\n\n\nb").text)
    }
}
