package io.github.sirbughunter.agenticwear.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.GenericShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import kotlin.math.atan2
import kotlin.math.sqrt
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.requestFocusOnHierarchyActive
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.TimeText
import androidx.wear.compose.material3.timeTextCurvedText
import androidx.wear.compose.foundation.CurvedTextStyle

/**
 * Agentic Wear design tokens: an OLED-black, neutral-grey palette with white
 * primary actions and status colours used only for small signals.
 */
internal object Aw {
    val Bg = Color(0xFF000000)
    val Surface = Color(0xFF141414)
    val SurfaceRaised = Color(0xFF1C1C1C)
    val SurfaceHigh = Color(0xFF262626)
    val Line = Color(0x14FFFFFF)
    val LineStrong = Color(0x38FFFFFF)
    val Text = Color(0xFFF4F4F4)
    val TextSecondary = Color(0xFFA6A6A6)
    val TextTertiary = Color(0xFF8C8C8C)
    val OnPrimary = Color(0xFF0A0A0A)
    val Working = Color(0xFF8AB4FF)
    val Ready = Color(0xFF5AD08C)
    val ReadyText = Color(0xFF86E3AD)
    val Attention = Color(0xFFF2B24A)
    val Error = Color(0xFFFF6B6B)
    val ErrorText = Color(0xFFFF9A9A)
    val End = Color(0xFFE5484D)
    val ErrorSurface = Color(0xFF2A1416)
    val ErrorSoft = Color(0xFFFFC2C2)
    val AttentionSurface = Color(0xFF1C1710)

    val CardShape = RoundedCornerShape(22.dp)
    val PillShape = RoundedCornerShape(50)
    val MotionDuration = 340
}

internal object AwType {
    val Title = TextStyle(fontSize = 14.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold, color = Aw.Text)
    val Body = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, color = Aw.Text)
    val Row = TextStyle(fontSize = 13.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium, color = Aw.Text)
    val Label = TextStyle(fontSize = 12.sp, lineHeight = 15.sp, fontWeight = FontWeight.Medium, color = Aw.TextSecondary)
    val Caption = TextStyle(fontSize = 11.sp, lineHeight = 14.sp, color = Aw.TextSecondary)
    val Micro = TextStyle(fontSize = 10.sp, lineHeight = 13.sp, color = Aw.TextTertiary)
}

/**
 * Scales a pressed control with a springy press and a small bounce on release, and lays a faint
 * white highlight over it while held. Scale runs in a GPU layer and the highlight in the draw
 * phase, so presses never recompose or relayout.
 */
@Composable
internal fun Modifier.pressScale(interactions: MutableInteractionSource, pressedScale: Float = 0.96f): Modifier {
    val pressed by interactions.collectIsPressedAsState()
    val scale by animateFloatAsState(
        if (pressed) pressedScale else 1f,
        if (pressed) spring(dampingRatio = .6f, stiffness = 900f) else spring(dampingRatio = .45f, stiffness = 500f),
        label = "press",
    )
    val highlight by animateFloatAsState(if (pressed) .06f else 0f, tween(120), label = "press highlight")
    return graphicsLayer { scaleX = scale; scaleY = scale }
        .drawWithContent {
            drawContent()
            if (highlight > .001f) drawRect(Color.White.copy(alpha = highlight))
        }
}

/** Fades scrolled content into the bezel at the top and bottom of the round screen. */
internal fun Modifier.fadeEdges(top: Dp = 42.dp, bottom: Dp = 30.dp): Modifier =
    graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
        .drawWithContent {
            drawContent()
            val h = size.height
            drawRect(
                brush = Brush.verticalGradient(
                    0f to Color.Transparent,
                    (top.toPx() * 0.5f / h).coerceIn(0f, .5f) to Color.Transparent,
                    (top.toPx() / h).coerceIn(0f, .5f) to Color.Black,
                    (1f - bottom.toPx() / h).coerceIn(.5f, 1f) to Color.Black,
                    1f to Color.Transparent,
                ),
                blendMode = BlendMode.DstIn,
            )
        }

@Composable
internal fun AwTimeText() {
    TimeText { time -> timeTextCurvedText(time, CurvedTextStyle(fontSize = 12.sp, color = Color(0xFFE8E8E8))) }
}

@Composable
internal fun roundHorizontalPadding(): Dp {
    val config = LocalConfiguration.current
    return if (config.isScreenRound) (config.screenWidthDp * 0.085f).dp else 12.dp
}

/** A crown-scrollable, edge-faded column for detail screens and dialogs. */
@Composable
internal fun AwScrollColumn(
    modifier: Modifier = Modifier,
    scrollState: ScrollState = rememberScrollState(),
    topPadding: Dp = 32.dp,
    bottomPadding: Dp = 64.dp,
    spacing: Dp = 6.dp,
    horizontalAlignment: Alignment.Horizontal = Alignment.CenterHorizontally,
    content: @Composable ColumnScope.() -> Unit,
) {
    val focus = remember { FocusRequester() }
    Column(
        modifier
            .fillMaxSize()
            .fadeEdges()
            .requestFocusOnHierarchyActive()
            .rotaryScrollable(RotaryScrollableDefaults.behavior(scrollState), focus)
            .verticalScroll(scrollState)
            .padding(horizontal = roundHorizontalPadding())
            .padding(top = topPadding, bottom = bottomPadding),
        verticalArrangement = Arrangement.spacedBy(spacing),
        horizontalAlignment = horizontalAlignment,
    ) { content() }
}

/** A crown-scrollable, edge-faded lazy list. */
@Composable
internal fun AwLazyColumn(
    modifier: Modifier = Modifier,
    state: LazyListState = rememberLazyListState(),
    topPadding: Dp = 32.dp,
    bottomPadding: Dp = 64.dp,
    spacing: Dp = 6.dp,
    content: LazyListScope.() -> Unit,
) {
    val focus = remember { FocusRequester() }
    LazyColumn(
        modifier
            .fillMaxSize()
            .fadeEdges()
            .requestFocusOnHierarchyActive()
            .rotaryScrollable(RotaryScrollableDefaults.behavior(state), focus),
        state = state,
        contentPadding = PaddingValues(
            start = roundHorizontalPadding(),
            end = roundHorizontalPadding(),
            top = topPadding,
            bottom = bottomPadding,
        ),
        verticalArrangement = Arrangement.spacedBy(spacing),
        horizontalAlignment = Alignment.CenterHorizontally,
        content = content,
    )
}

@Composable
internal fun AwScreenTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = AwType.Title,
        textAlign = TextAlign.Center,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 2.dp),
    )
}

@Composable
internal fun AwSectionLabel(text: String) {
    Text(
        text,
        style = AwType.Micro.copy(fontWeight = FontWeight.SemiBold, fontSize = 10.5.sp),
        modifier = Modifier.fillMaxWidth().padding(start = 12.dp, top = 8.dp, bottom = 1.dp),
    )
}

/**
 * Edge button outline: rounded top corners, with a bottom arc concentric with
 * the round display so the gap to the bezel stays even all the way around.
 */
internal class EdgeButtonShape(private val screenRadiusPx: Float, private val bottomInsetPx: Float) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val w = size.width
        val h = size.height
        val cx = w / 2f
        val rr = screenRadiusPx - bottomInsetPx
        val cy = h - rr
        val corner = minOf(h * 0.46f, w * 0.2f)
        val sideY = (if (rr > cx) cy + sqrt(rr * rr - cx * cx) else h * 0.5f).coerceIn(corner, h)
        val start = Math.toDegrees(atan2((sideY - cy).toDouble(), (w - cx).toDouble())).toFloat()
        val path = Path().apply {
            moveTo(0f, corner)
            quadraticTo(0f, 0f, corner, 0f)
            lineTo(w - corner, 0f)
            quadraticTo(w, 0f, w, corner)
            lineTo(w, sideY)
            arcTo(Rect(cx - rr, cy - rr, cx + rr, cy + rr), start, 180f - 2f * start, false)
            close()
        }
        return Outline.Generic(path)
    }
}

/**
 * The single most important action on a screen, hugging the bottom bezel.
 * Supports an optional long press (Send uses it for Steer/Queue).
 */
@Composable
internal fun BoxScope.AwEdgeButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    primary: Boolean = true,
    enabled: Boolean = true,
    onLongClick: (() -> Unit)? = null,
    onLongClickLabel: String? = null,
) {
    val config = LocalConfiguration.current
    val width = (config.screenWidthDp * 0.58f).dp
    val height = (config.screenHeightDp * 0.21f).dp.coerceAtLeast(44.dp)
    val density = LocalDensity.current
    val shape: Shape = remember(config.screenWidthDp, config.isScreenRound, density) {
        if (config.isScreenRound) with(density) { EdgeButtonShape((config.screenWidthDp / 2f).dp.toPx(), 3.dp.toPx()) } else Aw.PillShape
    }
    val interactions = remember { MutableInteractionSource() }
    val haptics = LocalHapticFeedback.current
    val container = when {
        !enabled -> Aw.SurfaceHigh
        primary -> Aw.Text
        else -> Aw.SurfaceRaised
    }
    val content = when {
        !enabled -> Color(0xFF707070)
        primary -> Aw.OnPrimary
        else -> Aw.Text
    }
    // Bottom fade so scrolled content never collides with the action.
    Box(
        Modifier
            .align(Alignment.BottomCenter)
            .fillMaxWidth()
            .height(height + 26.dp)
            .background(Brush.verticalGradient(0f to Color.Transparent, .38f to Color.Black.copy(alpha = .94f), 1f to Color.Black)),
    )
    Row(
        modifier
            .align(Alignment.BottomCenter)
            .padding(bottom = 3.dp)
            .size(width, height)
            .pressScale(interactions)
            .clip(shape)
            .background(container)
            .then(if (!primary && enabled) Modifier.border(1.dp, Aw.Line, shape) else Modifier)
            .combinedClickable(
                interactionSource = interactions,
                indication = null,
                enabled = enabled,
                role = Role.Button,
                onLongClickLabel = onLongClickLabel,
                onLongClick = onLongClick?.let { long -> { haptics.performHapticFeedback(HapticFeedbackType.LongPress); long() } },
                onClick = onClick,
            )
            .padding(bottom = height * 0.14f),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(17.dp))
            Spacer(Modifier.width(5.dp))
        }
        Text(label, color = content, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** A full-width tappable row card used for chats, activity and settings. */
@Composable
internal fun AwRowCard(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    enabled: Boolean = true,
    minHeight: Dp = 52.dp,
    container: Color = Aw.Surface,
    onLongClick: (() -> Unit)? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val interactions = remember { MutableInteractionSource() }
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = minHeight)
            .pressScale(interactions, 0.97f)
            .clip(Aw.CardShape)
            .background(container)
            .then(if (selected) Modifier.border(1.dp, Aw.LineStrong, Aw.CardShape) else Modifier)
            .combinedClickable(
                interactionSource = interactions,
                indication = null,
                enabled = enabled,
                role = Role.Button,
                onLongClick = onLongClick,
                onClick = onClick,
            )
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
        content = content,
    )
}

@Composable
internal fun AwRowText(title: String, subtitle: String?, modifier: Modifier = Modifier, subtitleColor: Color = Aw.TextSecondary, titleLines: Int = 2) {
    Column(modifier) {
        Text(title, style = AwType.Row, maxLines = titleLines, overflow = TextOverflow.Ellipsis)
        if (!subtitle.isNullOrBlank()) {
            Spacer(Modifier.height(2.dp))
            Text(subtitle, style = AwType.Caption.copy(color = subtitleColor), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** A single-choice option row with a radio indicator. */
@Composable
internal fun AwOption(title: String, subtitle: String?, selected: Boolean, onClick: () -> Unit, icon: ImageVector? = null) {
    val haptics = LocalHapticFeedback.current
    AwRowCard(
        onClick = { haptics.performHapticFeedback(HapticFeedbackType.ToggleOn); onClick() },
        selected = selected,
        container = if (selected) Aw.SurfaceRaised else Aw.Surface,
        minHeight = 50.dp,
        modifier = Modifier.semantics(mergeDescendants = true) {
            this.selected = selected
            stateDescription = if (selected) "Selected" else "Not selected"
        },
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = Aw.TextSecondary, modifier = Modifier.size(17.dp))
        AwRowText(title, subtitle, Modifier.weight(1f))
        RadioDot(selected)
    }
}

@Composable
internal fun RadioDot(selected: Boolean) {
    Box(
        Modifier
            .size(18.dp)
            .clip(CircleShape)
            .background(if (selected) Aw.Text else Color.Transparent)
            .border(1.5.dp, if (selected) Aw.Text else Color(0xFF5A5A5A), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) Box(Modifier.size(6.dp).clip(CircleShape).background(Aw.OnPrimary))
    }
}

@Composable
internal fun AwToggleRow(title: String, subtitle: String?, checked: Boolean, onToggle: (Boolean) -> Unit) {
    val haptics = LocalHapticFeedback.current
    AwRowCard(
        onClick = { haptics.performHapticFeedback(HapticFeedbackType.ToggleOn); onToggle(!checked) },
        minHeight = 50.dp,
        modifier = Modifier.semantics(mergeDescendants = true) { stateDescription = if (checked) "On" else "Off" },
    ) {
        AwRowText(title, subtitle, Modifier.weight(1f))
        val knob by animateFloatAsState(if (checked) 1f else 0f, spring(dampingRatio = .6f, stiffness = 500f), label = "toggle")
        Box(
            Modifier
                .size(34.dp, 20.dp)
                .clip(Aw.PillShape)
                .background(if (checked) Aw.Text else Color(0xFF3A3A3A)),
        ) {
            Box(
                Modifier
                    .offset(x = (2 + 14 * knob).dp, y = 2.dp)
                    .size(16.dp)
                    .clip(CircleShape)
                    .background(if (checked) Aw.OnPrimary else Aw.Text),
            )
        }
    }
}

/** A pill button for secondary or paired actions (Allow / Decline). */
@Composable
internal fun AwPillButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    height: Dp = 40.dp,
    destructive: Boolean = false,
) {
    val interactions = remember { MutableInteractionSource() }
    val container = when {
        destructive -> Aw.End
        primary -> Aw.Text
        else -> Aw.SurfaceHigh
    }
    val content = if (primary && !destructive) Aw.OnPrimary else Aw.Text
    Row(
        modifier
            .heightIn(min = height)
            .pressScale(interactions)
            .graphicsLayer { alpha = if (enabled) 1f else .45f }
            .clip(Aw.PillShape)
            .background(container)
            .clickable(interactionSource = interactions, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(5.dp))
        }
        Text(label, color = content, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** A circular icon button; sizes stay at or above the 48 dp touch target. */
@Composable
internal fun AwCircleButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    container: Color = Aw.SurfaceRaised,
    content: Color = Aw.Text,
    enabled: Boolean = true,
    bordered: Boolean = true,
    badge: Color? = null,
) {
    val interactions = remember { MutableInteractionSource() }
    Box(
        modifier
            .size(maxOf(size, 48.dp))
            .clickable(interactionSource = interactions, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { this.contentDescription = contentDescription },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(size)
                .pressScale(interactions, 0.92f)
                .graphicsLayer { alpha = if (enabled) 1f else .45f }
                .clip(CircleShape)
                .background(container)
                .then(if (bordered) Modifier.border(1.dp, Aw.Line, CircleShape) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(size * 0.45f))
        }
        if (badge != null) {
            Box(
                Modifier
                    .align(Alignment.Center)
                    .offset(x = size * 0.32f, y = -size * 0.32f)
                    .size(9.dp)
                    .clip(CircleShape)
                    .background(Aw.SurfaceRaised)
                    .padding(1.5.dp)
                    .clip(CircleShape)
                    .background(badge),
            )
        }
    }
}

internal enum class StatusKind { Ready, Working, Attention, Error, Idle, Live, Dot }

/** Small status signal: a dot, a pulsing dot, or a spinner for active work. */
@Composable
internal fun StatusIndicator(kind: StatusKind, modifier: Modifier = Modifier) {
    when (kind) {
        StatusKind.Working -> {
            val transition = rememberInfiniteTransition(label = "spinner")
            val angle by transition.animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing)), label = "spin")
            Canvas(modifier.size(10.dp).graphicsLayer { rotationZ = angle }) {
                val stroke = 2.dp.toPx()
                drawCircle(Aw.Working.copy(alpha = .25f), radius = size.minDimension / 2 - stroke / 2, style = Stroke(stroke))
                drawArc(Aw.Working, -90f, 90f, false, style = Stroke(stroke, cap = StrokeCap.Round),
                    topLeft = Offset(stroke / 2, stroke / 2),
                    size = androidx.compose.ui.geometry.Size(size.width - stroke, size.height - stroke))
            }
        }
        StatusKind.Attention, StatusKind.Live -> {
            val transition = rememberInfiniteTransition(label = "pulse")
            val alpha by transition.animateFloat(1f, .35f, infiniteRepeatable(tween(800), RepeatMode.Reverse), label = "pulse")
            Box(modifier.size(8.dp).graphicsLayer { this.alpha = alpha }.clip(CircleShape)
                .background(if (kind == StatusKind.Live) Aw.Ready else Aw.Attention))
        }
        StatusKind.Idle -> Box(modifier.size(8.dp).clip(CircleShape).border(1.5.dp, Color(0xFF6B6B6B), CircleShape))
        StatusKind.Dot -> Box(modifier.size(8.dp).clip(CircleShape).background(Aw.Text))
        StatusKind.Ready -> Box(modifier.size(8.dp).clip(CircleShape).background(Aw.Ready))
        StatusKind.Error -> Box(modifier.size(8.dp).clip(CircleShape).background(Aw.Error))
    }
}

/** ChatGPT-style shimmering label for work in progress. */
@Composable
internal fun ShimmerText(text: String, modifier: Modifier = Modifier, fontSize: TextUnit = 12.sp, fontWeight: FontWeight = FontWeight.Medium) {
    val transition = rememberInfiniteTransition(label = "shimmer")
    val progress by transition.animateFloat(-1f, 2f, infiniteRepeatable(tween(1900, easing = LinearEasing)), label = "shimmer")
    val reduced = !android.animation.ValueAnimator.areAnimatorsEnabled()
    Text(
        text,
        modifier = modifier,
        maxLines = 1,
        style = TextStyle(
            fontSize = fontSize,
            fontWeight = fontWeight,
            brush = if (reduced) Brush.linearGradient(listOf(Aw.TextSecondary, Aw.TextSecondary)) else Brush.horizontalGradient(
                0f to Color(0xFF6E6E6E),
                (progress - .25f).coerceIn(0f, 1f) to Color(0xFF6E6E6E),
                progress.coerceIn(0f, 1f) to Aw.Text,
                (progress + .25f).coerceIn(0f, 1f) to Color(0xFF6E6E6E),
                1f to Color(0xFF6E6E6E),
            ),
        ),
    )
}
