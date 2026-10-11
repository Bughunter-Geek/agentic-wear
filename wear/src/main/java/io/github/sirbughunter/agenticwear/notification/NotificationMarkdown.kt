package io.github.sirbughunter.agenticwear.notification

import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import io.github.sirbughunter.agenticwear.ui.BLOCK_QUOTE
import io.github.sirbughunter.agenticwear.ui.HEADING
import io.github.sirbughunter.agenticwear.ui.HORIZONTAL_RULE
import io.github.sirbughunter.agenticwear.ui.ORDERED_LIST
import io.github.sirbughunter.agenticwear.ui.UNORDERED_LIST

internal enum class MdStyle { BOLD, ITALIC, CODE, STRIKE }

internal data class MdSpan(val start: Int, val end: Int, val style: MdStyle)

/** Platform-free result of the conversion; [markdownToSpannable] only maps it onto Android spans. */
internal data class MdText(val text: String, val spans: List<MdSpan>)

/** Notification text: markdown syntax removed, dangling markers dropped, spans for emphasis and code. */
internal fun markdownToSpannable(markdown: String): SpannableStringBuilder {
    val model = markdownToMdText(markdown)
    return SpannableStringBuilder(model.text).apply {
        for (span in model.spans) {
            if (span.end <= span.start) continue
            val what: Any = when (span.style) {
                MdStyle.BOLD -> StyleSpan(Typeface.BOLD)
                MdStyle.ITALIC -> StyleSpan(Typeface.ITALIC)
                MdStyle.CODE -> TypefaceSpan("monospace")
                MdStyle.STRIKE -> StrikethroughSpan()
            }
            setSpan(what, span.start, span.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }
}

internal fun markdownToMdText(markdown: String): MdText {
    val out = StringBuilder()
    val spans = mutableListOf<MdSpan>()
    val lines = markdown.replace("\r\n", "\n").replace('\r', '\n').trim().lines()
    var inFence = false
    var blankRun = 0

    fun newLineIfNeeded() {
        if (out.isNotEmpty() && out.last() != '\n') out.append('\n')
    }

    for (rawLine in lines) {
        val line = rawLine.trimEnd()
        if (line.trimStart().startsWith("```")) {
            inFence = !inFence
            continue
        }
        if (!inFence && HORIZONTAL_RULE.matches(line)) continue
        if (!inFence && line.isBlank()) {
            blankRun += 1
            continue
        }
        if (out.isNotEmpty()) {
            out.append('\n')
            if (blankRun > 0) out.append('\n')
        }
        blankRun = 0
        val lineStart = out.length
        if (inFence) {
            out.append(line)
            spans += MdSpan(lineStart, out.length, MdStyle.CODE)
            continue
        }
        val heading = HEADING.matchEntire(line)
        val unordered = UNORDERED_LIST.matchEntire(line)
        val ordered = ORDERED_LIST.matchEntire(line)
        val quote = BLOCK_QUOTE.matchEntire(line)
        when {
            heading != null -> {
                appendInline(heading.groupValues[2], out, spans, setOf(MdStyle.BOLD))
            }
            unordered != null -> {
                out.append("• ")
                appendInline(unordered.groupValues[1], out, spans, emptySet())
            }
            ordered != null -> {
                out.append(ordered.groupValues[1]).append(". ")
                appendInline(ordered.groupValues[2], out, spans, emptySet())
            }
            quote != null -> {
                out.append("│ ")
                val contentStart = out.length
                appendInline(quote.groupValues[1], out, spans, setOf(MdStyle.ITALIC))
                if (out.length == contentStart) { out.setLength(lineStart) }
            }
            else -> appendInline(line, out, spans, emptySet())
        }
        // Dropping a dangling marker can leave a trailing space.
        while (out.length > lineStart && out.last() == ' ') out.setLength(out.length - 1)
        for (i in spans.indices) if (spans[i].end > out.length) spans[i] = spans[i].copy(end = out.length)
    }
    newLineIfNeeded()
    val text = out.toString().trimEnd('\n')
    return MdText(text, spans.filter { it.start < text.length }.map { it.copy(end = minOf(it.end, text.length)) })
}

private val INLINE = Regex(
    """\\.|!\[([^]]*)]\([^)]*\)|\[([^]]+)]\([^)]*\)|\*\*\*.+?\*\*\*|___.+?___|\*\*.+?\*\*|__.+?__|~~.+?~~|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_""",
)
private val TRUNCATED_LINK = Regex("""!?\[([^\]]*)]\([^)]*$""")

private fun appendInline(source: String, out: StringBuilder, spans: MutableList<MdSpan>, styles: Set<MdStyle>) {
    var index = 0
    fun plain(value: String) {
        val cleaned = stripDanglingMarkers(value)
        if (cleaned.isNotEmpty()) appendStyled(cleaned, out, spans, styles)
    }
    while (index < source.length) {
        val match = INLINE.find(source, index)
        if (match == null) {
            plain(source.substring(index))
            return
        }
        if (match.range.first > index) plain(source.substring(index, match.range.first))
        val token = match.value
        when {
            token.startsWith("\\") -> appendStyled(token.drop(1), out, spans, styles)
            token.startsWith("![") -> appendStyled(match.groups[1]?.value.orEmpty().ifBlank { "Image" }, out, spans, styles)
            token.startsWith("[") -> appendStyled(match.groups[2]?.value.orEmpty(), out, spans, styles)
            token.startsWith("***") || token.startsWith("___") ->
                appendInline(token.substring(3, token.length - 3), out, spans, styles + MdStyle.BOLD + MdStyle.ITALIC)
            token.startsWith("**") || token.startsWith("__") ->
                appendInline(token.substring(2, token.length - 2), out, spans, styles + MdStyle.BOLD)
            token.startsWith("~~") ->
                appendInline(token.substring(2, token.length - 2), out, spans, styles + MdStyle.STRIKE)
            token.startsWith("`") -> appendStyled(token.substring(1, token.length - 1), out, spans, styles + MdStyle.CODE)
            token.startsWith("*") || token.startsWith("_") ->
                appendInline(token.substring(1, token.length - 1), out, spans, styles + MdStyle.ITALIC)
            else -> appendStyled(token, out, spans, styles)
        }
        index = match.range.last + 1
    }
}

private fun appendStyled(value: String, out: StringBuilder, spans: MutableList<MdSpan>, styles: Set<MdStyle>) {
    if (value.isEmpty()) return
    val start = out.length
    out.append(value)
    styles.forEach { spans += MdSpan(start, out.length, it) }
}

/**
 * Text left over after every complete token was consumed can still hold openers whose closer was cut
 * off (a trailing `**`, a lone backtick, `[label](http://trunc`). They are dropped, not shown.
 */
internal fun stripDanglingMarkers(value: String): String {
    var s = TRUNCATED_LINK.replace(value) { it.groupValues[1] }
    s = s.replace("**", "").replace("~~", "").replace("`", "")
    val out = StringBuilder()
    var i = 0
    while (i < s.length) {
        val c = s[i]
        if (c == '*' || c == '_') {
            var j = i
            while (j < s.length && s[j] == c) j++
            val before = if (i == 0) ' ' else s[i - 1]
            val after = if (j >= s.length) ' ' else s[j]
            val opener = before.isWhitespace() && !after.isWhitespace()
            val closer = !before.isWhitespace() && (after.isWhitespace() || !after.isLetterOrDigit()) && !(c == '_' && before.isLetterOrDigit() && after.isLetterOrDigit())
            if (opener || closer) {
                i = j
                continue
            }
            out.append(s, i, j)
            i = j
            continue
        }
        out.append(c)
        i++
    }
    return out.toString()
}
