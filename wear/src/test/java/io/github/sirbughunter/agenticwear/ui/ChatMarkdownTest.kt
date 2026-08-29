package io.github.sirbughunter.agenticwear.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatMarkdownTest {
    @Test
    fun `renders common Markdown without exposing control markers`() {
        val rendered = markdownToAnnotatedString(
            """
            ## Result

            This is **bold**, *italic*, and `code`.

            - First
            - [Second](https://example.com)
            """.trimIndent(),
        )

        assertEquals(
            "Result\n\nThis is bold, italic, and code.\n\n• First\n• Second",
            rendered.text,
        )
        assertFalse(rendered.text.contains("**"))
        assertFalse(rendered.text.contains("https://"))
        assertTrue(rendered.spanStyles.isNotEmpty())
    }

    @Test
    fun `keeps fenced code line breaks while removing the fence`() {
        val rendered = markdownToAnnotatedString(
            """
            ```kotlin
            val answer = 42
            println(answer)
            ```
            """.trimIndent(),
        )

        assertEquals("val answer = 42\nprintln(answer)", rendered.text)
        assertFalse(rendered.text.contains("```"))
    }
}
