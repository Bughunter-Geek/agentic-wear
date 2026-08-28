package io.github.sirbughunter.agenticwear.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material3.MaterialTheme

val Ink = Color(0xFF070910)
val Panel = Color(0xFF151827)
val PanelRaised = Color(0xFF20243A)
val Frost = Color(0xFFF4F7FF)
val Muted = Color(0xFFA9AEC2)
val Cyan = Color(0xFF79E7FF)
val Violet = Color(0xFFAD91FF)
val Mint = Color(0xFF64E6AE)
val Amber = Color(0xFFFFBF66)
val Coral = Color(0xFFFF6F86)

@Composable
fun AgenticWearTheme(content: @Composable () -> Unit) {
    MaterialTheme(content = content)
}
