package io.github.sirbughunter.agenticwear.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Text

@Composable
internal fun MarkdownMessageText(
    markdown: String,
    color: Color,
    accent: Color,
    codeBackground: Color,
    modifier: Modifier = Modifier,
    fontSize: TextUnit = 12.sp,
    lineHeight: TextUnit = 16.sp,
    maxLines: Int = Int.MAX_VALUE,
    overflow: TextOverflow = TextOverflow.Clip,
) {
    val rendered = remember(markdown, color, accent, codeBackground, fontSize) {
        markdownToAnnotatedString(markdown, color, accent, codeBackground, fontSize)
    }
    Text(
        text = rendered,
        modifier = modifier,
        color = color,
        fontSize = fontSize,
        lineHeight = lineHeight,
        maxLines = maxLines,
        overflow = overflow,
    )
}

internal fun markdownToAnnotatedString(
    markdown: String,
    color: Color = Color.White,
    accent: Color = Color.Cyan,
    codeBackground: Color = Color.DarkGray,
    fontSize: TextUnit = 12.sp,
): AnnotatedString = buildAnnotatedString {
    val lines = markdown
        .replace("\r\n", "\n")
        .replace('\r', '\n')
        .trim()
        .lines()
    var inCodeFence = false
    lines.forEachIndexed { index, rawLine ->
        val line = rawLine.trimEnd()
        if (line.trimStart().startsWith("```")) {
            inCodeFence = !inCodeFence
            return@forEachIndexed
        }
        when {
            inCodeFence -> withStyle(
                SpanStyle(
                    color = color,
                    background = codeBackground,
                    fontFamily = FontFamily.Monospace,
                    fontSize = (fontSize.value - 1f).coerceAtLeast(8f).sp,
                ),
            ) {
                append(if (line.isEmpty()) " " else line)
            }
            HEADING.matches(line) -> {
                val match = HEADING.matchEntire(line)!!
                val level = match.groupValues[1].length
                val headingSize = (fontSize.value + when (level) {
                    1 -> 4f
                    2 -> 3f
                    3 -> 2f
                    else -> 1f
                }).sp
                withStyle(SpanStyle(fontWeight = FontWeight.Bold, fontSize = headingSize)) {
                    appendInlineMarkdown(match.groupValues[2], color, accent, codeBackground, fontSize)
                }
            }
            UNORDERED_LIST.matches(line) -> {
                val content = UNORDERED_LIST.matchEntire(line)!!.groupValues[1]
                withStyle(SpanStyle(color = accent, fontWeight = FontWeight.Bold)) { append("• ") }
                appendInlineMarkdown(content, color, accent, codeBackground, fontSize)
            }
            ORDERED_LIST.matches(line) -> {
                val match = ORDERED_LIST.matchEntire(line)!!
                withStyle(SpanStyle(color = accent, fontWeight = FontWeight.Bold)) {
                    append("${match.groupValues[1]}. ")
                }
                appendInlineMarkdown(match.groupValues[2], color, accent, codeBackground, fontSize)
            }
            BLOCK_QUOTE.matches(line) -> {
                val content = BLOCK_QUOTE.matchEntire(line)!!.groupValues[1]
                withStyle(SpanStyle(color = accent, fontWeight = FontWeight.Bold)) { append("│ ") }
                withStyle(SpanStyle(color = color.copy(alpha = 0.88f), fontStyle = FontStyle.Italic)) {
                    appendInlineMarkdown(content, color, accent, codeBackground, fontSize)
                }
            }
            HORIZONTAL_RULE.matches(line) -> Unit
            else -> appendInlineMarkdown(line, color, accent, codeBackground, fontSize)
        }
        if (lines.drop(index + 1).any { !it.trimStart().startsWith("```") }) append('\n')
    }
}

private fun AnnotatedString.Builder.appendInlineMarkdown(
    source: String,
    color: Color,
    accent: Color,
    codeBackground: Color,
    fontSize: TextUnit,
) {
    var index = 0
    while (index < source.length) {
        val match = INLINE_TOKEN.find(source, index)
        if (match == null) {
            append(source.substring(index))
            return
        }
        if (match.range.first > index) append(source.substring(index, match.range.first))
        val token = match.value
        when {
            token.startsWith("\\") -> append(token.drop(1))
            token.startsWith("![") -> {
                val label = match.groups[1]?.value.orEmpty().ifBlank { "Image" }
                withStyle(SpanStyle(color = color.copy(alpha = 0.8f), fontStyle = FontStyle.Italic)) {
                    append(label)
                }
            }
            token.startsWith("[") -> withStyle(
                SpanStyle(color = accent, textDecoration = TextDecoration.Underline),
            ) {
                append(match.groups[2]?.value.orEmpty())
            }
            token.startsWith("**") || token.startsWith("__") -> withStyle(
                SpanStyle(fontWeight = FontWeight.Bold),
            ) {
                appendInlineMarkdown(token.substring(2, token.length - 2), color, accent, codeBackground, fontSize)
            }
            token.startsWith("~~") -> withStyle(
                SpanStyle(textDecoration = TextDecoration.LineThrough),
            ) {
                appendInlineMarkdown(token.substring(2, token.length - 2), color, accent, codeBackground, fontSize)
            }
            token.startsWith("`") -> withStyle(
                SpanStyle(
                    color = accent,
                    background = codeBackground,
                    fontFamily = FontFamily.Monospace,
                    fontSize = (fontSize.value - 1f).coerceAtLeast(8f).sp,
                ),
            ) {
                append(token.substring(1, token.length - 1))
            }
            token.startsWith("*") || token.startsWith("_") -> withStyle(
                SpanStyle(fontStyle = FontStyle.Italic),
            ) {
                appendInlineMarkdown(token.substring(1, token.length - 1), color, accent, codeBackground, fontSize)
            }
            else -> append(token)
        }
        index = match.range.last + 1
    }
}

private val HEADING = Regex("^\\s*(#{1,6})\\s+(.+)$")
private val UNORDERED_LIST = Regex("^\\s*[-+*]\\s+(.+)$")
private val ORDERED_LIST = Regex("^\\s*(\\d+)[.)]\\s+(.+)$")
private val BLOCK_QUOTE = Regex("^\\s*>\\s?(.*)$")
private val HORIZONTAL_RULE = Regex("^\\s*(?:-{3,}|_{3,}|\\*{3,})\\s*$")
private val INLINE_TOKEN = Regex(
    """\\.|!\[([^]]*)]\([^)]*\)|\[([^]]+)]\([^)]*\)|\*\*.+?\*\*|__.+?__|~~.+?~~|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_""",
)
