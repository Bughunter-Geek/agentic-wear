package io.github.sirbughunter.agenticwear.live

import android.graphics.Bitmap
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlin.math.exp
import kotlin.math.sin

/** Colours observed in Hendrik's9 PNG references and teal recording. */
internal enum class LiveVoiceColour(val label: String, val rgb: Int) {
    TEAL("Teal", 0x00B7A0), BLUE("Blue", 0x4BAFEC), INDIGO("Indigo", 0x4A67E8),
    VIOLET("Violet", 0x9A64EC), MAGENTA("Magenta", 0xC767D1), ROSE("Rose", 0xDF72A4),
    CORAL("Coral", 0xE88D74), YELLOW("Yellow", 0xF0CD56), LIME("Lime", 0xB1CE38),
    MONO("Monochrome", 0x151515);

    companion object {
        fun fromLabel(value: String): LiveVoiceColour = entries.firstOrNull { it.label == value } ?: TEAL
    }
}

/** A cached deterministic matte cloud disk; no per-frame texture allocation or loop. */
internal fun cloudOrbTexture(colour: LiveVoiceColour): ImageBitmap {
    val side = 256
    val pixels = IntArray(side * side)
    val red = (colour.rgb shr 16) and 255
    val green = (colour.rgb shr 8) and 255
    val blue = colour.rgb and 255
    for (y in 0 until side) for (x in 0 until side) {
        val nx = x.toFloat() / (side - 1)
        val ny = y.toFloat() / (side - 1)
        val radiusSquared = (nx - .5f) * (nx - .5f) + (ny - .5f) * (ny - .5f)
        if (radiusSquared > .25f) continue
        val grain = ((x * 374761393 + y * 668265263).let { (it xor (it ushr 13)) * 1274126177 }
            .ushr(16) and 255) / 255f - .5f
        val cloud = sin(nx * 14f + sin(ny * 11f)) * .026f + sin(nx * 31f + ny * 19f) * .012f
        val edge = .72f - .38f * nx + cloud + grain * .024f
        val distance = (ny - edge) / .12f
        val band = exp(-distance * distance) * .36f
        val lower = ((ny - edge + .05f) / .18f).coerceIn(0f, 1f)
        val white = (.025f + .3f * ny + .25f * lower + band + grain * .032f).coerceIn(0f, .94f)
        fun mix(channel: Int) = (channel + (255 - channel) * white).toInt().coerceIn(0, 255)
        val alpha = ((.25f - radiusSquared) * side * 255f).toInt().coerceIn(0, 255)
        pixels[y * side + x] = (alpha shl 24) or (mix(red) shl 16) or (mix(green) shl 8) or mix(blue)
    }
    return Bitmap.createBitmap(pixels, side, side, Bitmap.Config.ARGB_8888).asImageBitmap()
}
