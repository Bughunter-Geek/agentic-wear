@file:Suppress("LongMethod")

package io.github.sirbughunter.agenticwear.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.sirbughunter.agenticwear.BuildConfig
import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AlertKind
import io.github.sirbughunter.agenticwear.model.ApprovalMode
import io.github.sirbughunter.agenticwear.model.SessionStatus
import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import io.github.sirbughunter.agenticwear.update.UpdateStage
import io.github.sirbughunter.agenticwear.update.UpdateUiState
import java.text.DateFormat
import java.util.Date
import androidx.wear.compose.material3.Text
import kotlinx.coroutines.launch

private val AgenticEaseOut = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)
private val SurfaceShape = RoundedCornerShape(24.dp)

@Composable
fun AgenticWearApp(
    viewModel: AgenticWearViewModel,
    onPushToTalkStart: () -> Unit,
    onPushToTalkEnd: () -> Unit,
    pairingCodePrefill: String = "",
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.radialGradient(
                    colors = listOf(Color(0xFF211B3A), Ink, Color.Black),
                    center = Offset(210f, 80f),
                    radius = 520f,
                ),
            ),
    ) {
        AnimatedContent(
            targetState = state.screen,
            transitionSpec = {
                val enter: EnterTransition = fadeIn(tween(180, easing = AgenticEaseOut)) +
                    scaleIn(tween(180, easing = AgenticEaseOut), initialScale = 0.96f)
                val exit: ExitTransition = fadeOut(tween(140, easing = AgenticEaseOut)) +
                    scaleOut(tween(140, easing = AgenticEaseOut), targetScale = 0.98f)
                enter togetherWith exit
            },
            label = "screen transition",
        ) { screen ->
            when (screen) {
                WearScreen.HOME -> HomeScreen(
                    state = state,
                    onPushToTalkStart = onPushToTalkStart,
                    onPushToTalkEnd = onPushToTalkEnd,
                    onSessions = { viewModel.navigate(WearScreen.SESSIONS) },
                    onSettings = { viewModel.navigate(WearScreen.SETTINGS) },
                    onAlert = { viewModel.navigate(WearScreen.ALERT) },
                )
                WearScreen.PAIR -> PairScreen(
                    relayDefault = state.relayUrl,
                    codeDefault = pairingCodePrefill,
                    pending = state.pending,
                    error = state.error,
                    onPair = viewModel::pair,
                )
                WearScreen.SESSIONS -> SessionsScreen(
                    state = state,
                    onBack = { viewModel.navigate(WearScreen.HOME) },
                    onSelect = viewModel::selectSession,
                )
                WearScreen.TRANSCRIPT -> TranscriptScreen(
                    state = state,
                    onBack = viewModel::retryTranscript,
                    onTextChanged = viewModel::updateTranscript,
                    onSend = viewModel::submitTranscript,
                    onRetry = viewModel::retryTranscript,
                )
                WearScreen.ALERT -> AlertScreen(
                    alert = state.latestAlert,
                    approvalMode = state.approvalMode,
                    pending = state.pending,
                    onBack = { viewModel.navigate(WearScreen.HOME) },
                    onApprove = { viewModel.respondToApproval(true) },
                    onDecline = { viewModel.respondToApproval(false) },
                )
                WearScreen.SETTINGS -> SettingsScreen(
                    state = state,
                    onBack = { viewModel.navigate(WearScreen.HOME) },
                    onEngine = viewModel::setTranscriptionEngine,
                    onApprovalMode = viewModel::setApprovalMode,
                    onUpdate = viewModel::onUpdateAction,
                    onDisconnect = viewModel::disconnect,
                )
            }
        }
        state.error?.takeIf { state.screen != WearScreen.PAIR }?.let { error ->
            ErrorPill(error, Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp))
        }
        AnimatedVisibility(
            visible = state.showInstallPermissionPrompt,
            enter = fadeIn(tween(180, easing = AgenticEaseOut)) +
                scaleIn(tween(200, easing = AgenticEaseOut), initialScale = 0.94f),
            exit = fadeOut(tween(130, easing = AgenticEaseOut)) +
                scaleOut(tween(130, easing = AgenticEaseOut), targetScale = 0.97f),
        ) {
            InstallPermissionPrompt(
                onOpenSettings = viewModel::openInstallPermission,
                onDismiss = viewModel::dismissInstallPermissionPrompt,
            )
        }
    }
}

@Composable
private fun InstallPermissionPrompt(
    onOpenSettings: () -> Unit,
    onDismiss: () -> Unit,
) {
    val blockerInteractions = remember { MutableInteractionSource() }
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.76f))
            .clickable(
                interactionSource = blockerInteractions,
                indication = null,
                role = Role.Button,
                onClick = {},
            )
            .padding(horizontal = 24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(SurfaceShape)
                .background(Brush.linearGradient(listOf(PanelRaised, Panel)))
                .border(1.dp, Violet.copy(alpha = 0.72f), SurfaceShape)
                .padding(horizontal = 16.dp, vertical = 15.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier
                    .size(27.dp)
                    .clip(CircleShape)
                    .background(Violet.copy(alpha = 0.16f))
                    .border(1.dp, Violet.copy(alpha = 0.74f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text("↓", color = Cyan, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(5.dp))
            Text(
                "One-time permission",
                color = Frost,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                maxLines = 1,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "Enable “Install unknown apps” on the next screen, then return. Your data stays intact.",
                color = Muted,
                fontSize = 10.sp,
                lineHeight = 13.sp,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(8.dp))
            ActionButton(
                label = "Open settings",
                primary = true,
                onClick = onOpenSettings,
                enabled = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                "Not now",
                color = Muted,
                fontSize = 9.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clip(CircleShape)
                    .clickable(role = Role.Button, onClick = onDismiss)
                    .padding(horizontal = 14.dp, vertical = 4.dp),
            )
        }
    }
}

@Composable
private fun HomeScreen(
    state: WearUiState,
    onPushToTalkStart: () -> Unit,
    onPushToTalkEnd: () -> Unit,
    onSessions: () -> Unit,
    onSettings: () -> Unit,
    onAlert: () -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val compact = maxHeight < 420.dp
        val orbSize = if (compact) 68.dp else 148.dp
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = if (compact) 22.dp else 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(if (compact) 8.dp else 22.dp))
            ConnectionPill(connected = state.isPaired)
            Spacer(Modifier.height(if (compact) 4.dp else 8.dp))
            TactileCard(onClick = onSessions, modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(
                        horizontal = if (compact) 13.dp else 17.dp,
                        vertical = if (compact) 7.dp else 12.dp,
                    ),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    StatusDot(state.selectedSession?.status ?: SessionStatus.NOT_LOADED)
                    Spacer(Modifier.width(if (compact) 8.dp else 11.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = state.selectedSession?.title ?: "Choose a session",
                            color = Frost,
                            fontSize = if (compact) 12.sp else 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = state.selectedSession?.status?.label ?: "No session selected",
                            color = Muted,
                            fontSize = if (compact) 9.sp else 11.sp,
                        )
                    }
                    Text("›", color = Muted, fontSize = if (compact) 19.sp else 24.sp)
                }
            }
            Spacer(Modifier.height(if (compact) 2.dp else 10.dp))
            PushToTalkOrb(
                size = orbSize,
                recording = state.recording,
                pending = state.pending,
                enabled = state.isPaired && !state.pending,
                onStart = onPushToTalkStart,
                onEnd = onPushToTalkEnd,
            )
            Text(
                text = when {
                    state.recording -> "Listening… release to send"
                    state.pending -> "Agentic Wear is working…"
                    else -> "Hold to talk"
                },
                color = if (state.recording) Cyan else Muted,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(if (compact) 2.dp else 9.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(if (compact) 4.dp else 10.dp)) {
                MiniAction("Sessions", onSessions) {
                    Text("≡", color = Cyan, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                }
                if (state.latestAlert != null) {
                    MiniAction("Latest", onAlert) {
                        Text("●", color = Cyan, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    }
                }
                MiniAction("Settings", onSettings) { SettingsGlyph() }
            }
        }
    }
}

@Composable
private fun PushToTalkOrb(
    size: Dp,
    recording: Boolean,
    pending: Boolean,
    enabled: Boolean,
    onStart: () -> Unit,
    onEnd: () -> Unit,
) {
    var pressed by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    val compact = size <= 80.dp
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.96f else 1f,
        animationSpec = tween(140, easing = AgenticEaseOut),
        label = "push-to-talk press",
    )
    Box(contentAlignment = Alignment.Center, modifier = Modifier.size(size + if (compact) 12.dp else 20.dp)) {
        if (recording) {
            val transition = rememberInfiniteTransition(label = "recording pulse")
            val pulse by transition.animateFloat(
                initialValue = 0.82f,
                targetValue = 1.08f,
                animationSpec = infiniteRepeatable(tween(1_000, easing = LinearEasing)),
                label = "recording ring",
            )
            Box(
                Modifier
                    .size(size + if (compact) 10.dp else 16.dp)
                    .graphicsLayer {
                        scaleX = pulse
                        scaleY = pulse
                        alpha = (1.08f - pulse) * 1.8f
                    }
                    .border(2.dp, Cyan, CircleShape),
            )
        }
        Box(
            modifier = Modifier
                .size(size)
                .graphicsLayer { scaleX = scale; scaleY = scale }
                .clip(CircleShape)
                .background(
                    Brush.radialGradient(
                        listOf(Color(0xFF43466F), Color(0xFF262940), Color(0xFF121522)),
                    ),
                )
                .border(
                    1.5.dp,
                    Brush.sweepGradient(listOf(Cyan, Violet, Color(0xFF34384D), Cyan)),
                    CircleShape,
                )
                .semantics {
                    contentDescription = "Hold to talk to the selected agent"
                    role = Role.Button
                }
                .pointerInput(enabled, pending) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        if (!enabled) return@awaitEachGesture
                        down.consume()
                        pressed = true
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        onStart()
                        waitForUpOrCancellation()?.consume()
                        pressed = false
                        onEnd()
                    }
                }
                .alpha(if (enabled) 1f else 0.55f),
            contentAlignment = Alignment.Center,
        ) {
            AgentGlyph(recording = recording, pending = pending, modifier = Modifier.size(size * 0.48f))
        }
    }
}

@Composable
private fun AgentGlyph(recording: Boolean, pending: Boolean, modifier: Modifier = Modifier) {
    val accent = when {
        recording -> Cyan
        pending -> Violet
        else -> Frost
    }
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        drawArc(
            brush = Brush.sweepGradient(listOf(Cyan, Violet, Cyan)),
            startAngle = 127.5f,
            sweepAngle = 285f,
            useCenter = false,
            topLeft = Offset(w * 0.08f, h * 0.08f),
            size = androidx.compose.ui.geometry.Size(w * 0.84f, h * 0.84f),
            style = Stroke(w * 0.08f, cap = StrokeCap.Round),
        )
        val widths = w * 0.11f
        val xs = listOf(w * 0.32f, w * 0.50f, w * 0.68f)
        val heights = listOf(h * 0.27f, h * 0.48f, h * 0.34f)
        xs.indices.forEach { index ->
            drawLine(
                color = if (index == 1) accent else if (index == 0) Cyan else Violet,
                start = Offset(xs[index], (h - heights[index]) / 2f),
                end = Offset(xs[index], (h + heights[index]) / 2f),
                strokeWidth = widths,
                cap = StrokeCap.Round,
            )
        }
    }
}

@Composable
private fun SessionsScreen(state: WearUiState, onBack: () -> Unit, onSelect: (String) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Sessions", onBack)
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 22.dp, end = 22.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (state.sessions.isEmpty()) {
                item { EmptyState("No sessions yet", "Open Codex on your host, then refresh.") }
            }
            items(state.sessions, key = { it.id }) { session ->
                TactileCard(onClick = { onSelect(session.id) }, modifier = Modifier.fillMaxWidth()) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        StatusDot(session.status)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(session.title, color = Frost, fontSize = 13.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 2)
                            Spacer(Modifier.height(2.dp))
                            Text(
                                buildString {
                                    append(session.status.label)
                                    if (session.ownedByWear) append(" · watch-owned")
                                },
                                color = Muted,
                                fontSize = 10.sp,
                            )
                        }
                        if (session.id == state.selectedThreadId) Text("✓", color = Cyan, fontSize = 18.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun TranscriptScreen(
    state: WearUiState,
    onBack: () -> Unit,
    onTextChanged: (String) -> Unit,
    onSend: () -> Unit,
    onRetry: () -> Unit,
) {
    val transcript = state.transcript
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        ScreenHeader("Review", onBack, horizontalPadding = 28.dp)
        Text("Your prompt", color = Cyan, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(5.dp))
        Box(
            Modifier.fillMaxWidth().clip(SurfaceShape).background(Panel).border(1.dp, Color(0xFF373B55), SurfaceShape)
                .padding(10.dp),
        ) {
            BasicTextField(
                value = transcript?.text.orEmpty(),
                onValueChange = onTextChanged,
                textStyle = TextStyle(color = Frost, fontSize = 15.sp, lineHeight = 20.sp),
                cursorBrush = Brush.verticalGradient(listOf(Cyan, Violet)),
                modifier = Modifier.fillMaxWidth().height(60.dp),
            )
        }
        Spacer(Modifier.height(10.dp))
        Text(
            state.selectedSession?.title ?: "New session",
            color = Muted,
            fontSize = 10.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionButton("Retry", false, onRetry, enabled = !state.pending)
            ActionButton(if (state.pending) "Sending…" else "Send", true, onSend, enabled = !state.pending && !transcript?.text.isNullOrBlank())
        }
        Spacer(Modifier.height(48.dp))
    }
}

@Composable
private fun AlertScreen(
    alert: AgentAlert?,
    approvalMode: ApprovalMode,
    pending: Boolean,
    onBack: () -> Unit,
    onApprove: () -> Unit,
    onDecline: () -> Unit,
) {
    val color = when (alert?.kind) {
        AlertKind.COMPLETE -> Mint
        AlertKind.PERMISSION -> Amber
        AlertKind.ERROR -> Coral
        null -> Muted
    }
    val label = when (alert?.kind) {
        AlertKind.COMPLETE -> "WORK COMPLETE"
        AlertKind.PERMISSION -> "DECISION NEEDED"
        AlertKind.ERROR -> "AGENT STOPPED"
        null -> "NO RECENT ALERT"
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 25.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        ScreenHeader("Latest", onBack, horizontalPadding = 25.dp)
        Box(
            modifier = Modifier.size(48.dp).clip(CircleShape)
                .background(Brush.radialGradient(listOf(color.copy(alpha = 0.38f), color.copy(alpha = 0.08f))))
                .border(1.5.dp, color.copy(alpha = 0.8f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                when (alert?.kind) {
                    AlertKind.COMPLETE -> "✓"
                    AlertKind.PERMISSION -> "?"
                    AlertKind.ERROR -> "!"
                    null -> "·"
                },
                color = color,
                fontSize = 23.sp,
                fontWeight = FontWeight.Bold,
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(
            text = buildString {
                append(label)
                alert?.let {
                    append(" · ")
                    append(DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it.occurredAtMillis)))
                }
            },
            color = color,
            fontSize = 9.sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = 0.8.sp,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            alert?.title ?: "Nothing to show",
            color = Frost,
            fontSize = 16.sp,
            lineHeight = 18.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(5.dp))
        Text(
            alert?.detail ?: "Agent alerts will appear here.",
            color = Muted,
            fontSize = 11.sp,
            lineHeight = 14.sp,
            textAlign = TextAlign.Center,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
        if (alert?.kind == AlertKind.PERMISSION && alert.canControl && approvalMode == ApprovalMode.ALLOW_CONTROLS) {
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionButton("Decline", false, onDecline, !pending)
                ActionButton("Allow", true, onApprove, !pending, accent = Amber)
            }
        }
        Spacer(Modifier.height(48.dp))
    }
}

@Composable
private fun SettingsScreen(
    state: WearUiState,
    onBack: () -> Unit,
    onEngine: (TranscriptionEngine) -> Unit,
    onApprovalMode: (ApprovalMode) -> Unit,
    onUpdate: () -> Unit,
    onDisconnect: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Settings", onBack)
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 22.dp, end = 22.dp, bottom = 30.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            item { SectionLabel("TRANSCRIPTION") }
            item {
                SettingChoice(
                    title = "GPT Transcribe",
                    subtitle = "More accurate · runs on your host",
                    selected = state.transcriptionEngine == TranscriptionEngine.GPT_TRANSCRIBE,
                ) { onEngine(TranscriptionEngine.GPT_TRANSCRIBE) }
            }
            item {
                SettingChoice(
                    title = "Device speech",
                    subtitle = "Uses the watch speech service",
                    selected = state.transcriptionEngine == TranscriptionEngine.DEVICE_SPEECH,
                ) { onEngine(TranscriptionEngine.DEVICE_SPEECH) }
            }
            item { SectionLabel("APPROVALS") }
            item {
                SettingChoice(
                    title = "Alert only",
                    subtitle = "Safest default for every session",
                    selected = state.approvalMode == ApprovalMode.ALERT_ONLY,
                ) { onApprovalMode(ApprovalMode.ALERT_ONLY) }
            }
            item {
                SettingChoice(
                    title = "Allow controls",
                    subtitle = "Only for watch-owned sessions",
                    selected = state.approvalMode == ApprovalMode.ALLOW_CONTROLS,
                ) { onApprovalMode(ApprovalMode.ALLOW_CONTROLS) }
            }
            if (state.appUpdate.enabled) {
                item { SectionLabel("APP UPDATES") }
                item { UpdateCard(state.appUpdate, onUpdate) }
            }
            item { SectionLabel("CONNECTION") }
            item {
                TactileCard(onClick = onDisconnect, modifier = Modifier.fillMaxWidth()) {
                    Text("Disconnect bridge", color = Coral, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(16.dp))
                }
            }
            item {
                Text(
                    "Agentic Wear is an unofficial open-source companion. It is not affiliated with or endorsed by OpenAI.",
                    color = Muted,
                    fontSize = 10.sp,
                    lineHeight = 14.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(8.dp),
                )
            }
            item {
                Text(
                    "Version ${BuildConfig.VERSION_NAME} · build ${BuildConfig.VERSION_CODE}",
                    color = Muted.copy(alpha = 0.8f),
                    fontSize = 9.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun PairScreen(
    relayDefault: String,
    codeDefault: String,
    pending: Boolean,
    error: String?,
    onPair: (String, String) -> Unit,
) {
    var code by rememberSaveable(codeDefault) { mutableStateOf(sanitizePairingCodeInput(codeDefault)) }
    var relay by rememberSaveable(relayDefault) { mutableStateOf(relayDefault) }
    val normalizedCode = normalizePairingCodeInput(code)
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 26.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(8.dp))
        AgentGlyph(false, false, Modifier.size(40.dp))
        Spacer(Modifier.height(2.dp))
        Text("Agentic Wear", color = Frost, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Text("Connect your private bridge", color = Muted, fontSize = 11.sp)
        Spacer(Modifier.height(7.dp))
        InputSurface(
            value = code,
            onValueChange = { code = sanitizePairingCodeInput(it) },
            label = "8-character code",
            textAlign = TextAlign.Center,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
            actionLabel = "Paste",
            onAction = {
                scope.launch {
                    clipboard.getClipEntry()
                        ?.clipData
                        ?.takeIf { it.itemCount > 0 }
                        ?.getItemAt(0)
                        ?.coerceToText(context)
                        ?.toString()
                        ?.let(::extractPairingCode)
                        ?.let { code = it }
                }
            },
        )
        Spacer(Modifier.height(4.dp))
        InputSurface(
            value = relay,
            onValueChange = { relay = it.take(240) },
            label = "Relay URL",
            textAlign = TextAlign.Start,
        )
        error?.let { ErrorPill(it, Modifier.padding(top = 8.dp)) }
        Spacer(Modifier.height(6.dp))
        ActionButton(
            label = if (pending) "Connecting…" else "Connect",
            primary = true,
            onClick = { onPair(normalizedCode, relay) },
            enabled = !pending && normalizedCode.length == 8 && relay.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            "End-to-end encrypted · unofficial companion",
            color = Muted,
            fontSize = 9.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun InputSurface(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    textAlign: TextAlign,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Box(
        Modifier.fillMaxWidth().clip(SurfaceShape).background(Panel).border(1.dp, Color(0xFF34384E), SurfaceShape)
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        if (value.isBlank()) Text(label, color = Muted.copy(alpha = 0.72f), fontSize = 13.sp, modifier = Modifier.fillMaxWidth(), textAlign = textAlign)
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            textStyle = TextStyle(color = Frost, fontSize = 13.sp, textAlign = textAlign),
            keyboardOptions = keyboardOptions,
            cursorBrush = Brush.verticalGradient(listOf(Cyan, Violet)),
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        if (actionLabel != null && onAction != null) {
            Text(
                actionLabel,
                color = Cyan,
                fontSize = 9.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.CenterEnd)
                    .clip(CircleShape)
                    .background(Panel)
                    .clickable(role = Role.Button, onClick = onAction)
                    .padding(horizontal = 5.dp, vertical = 3.dp)
                    .semantics { contentDescription = "Paste pairing code" },
            )
        }
    }
}

@Composable
private fun ConnectionPill(connected: Boolean) {
    Row(
        Modifier.clip(CircleShape).background(Color(0xFF151A27).copy(alpha = 0.92f))
            .border(1.dp, Color(0xFF31364B), CircleShape).padding(horizontal = 11.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(if (connected) Mint else Coral))
        Spacer(Modifier.width(6.dp))
        Text(if (connected) "Bridge paired" else "Not paired", color = Frost, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun MiniAction(label: String, onClick: () -> Unit, content: @Composable () -> Unit) {
    TactileCard(
        onClick = onClick,
        modifier = Modifier.size(34.dp).semantics { contentDescription = label },
    ) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            content()
        }
    }
}

@Composable
private fun SettingsGlyph() {
    Canvas(Modifier.size(17.dp)) {
        val stroke = 1.6.dp.toPx()
        val start = 1.5.dp.toPx()
        val end = size.width - start
        fun drawTrack(y: Float, knobX: Float) {
            drawLine(Cyan, Offset(start, y), Offset(end, y), stroke, StrokeCap.Round)
            drawCircle(PanelRaised, 2.7.dp.toPx(), Offset(knobX, y))
            drawCircle(Cyan, 2.1.dp.toPx(), Offset(knobX, y), style = Stroke(stroke))
        }
        drawTrack(size.height * 0.24f, size.width * 0.36f)
        drawTrack(size.height * 0.5f, size.width * 0.68f)
        drawTrack(size.height * 0.76f, size.width * 0.45f)
    }
}

@Composable
private fun TactileCard(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable () -> Unit,
) {
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val scale by animateFloatAsState(
        if (pressed) 0.97f else 1f,
        tween(140, easing = AgenticEaseOut),
        label = "surface press",
    )
    Box(
        modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .alpha(if (enabled) 1f else 0.68f)
            .clip(SurfaceShape)
            .background(Brush.linearGradient(listOf(PanelRaised, Panel)))
            .border(1.dp, Color(0xFF363A52), SurfaceShape)
            .clickable(enabled = enabled, interactionSource = interactions, indication = null, role = Role.Button, onClick = onClick),
    ) { content() }
}

@Composable
private fun ActionButton(
    label: String,
    primary: Boolean,
    onClick: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    accent: Color = Cyan,
) {
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, tween(140, easing = AgenticEaseOut), label = "button press")
    Box(
        modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(CircleShape)
            .background(if (primary) accent else PanelRaised)
            .border(1.dp, if (primary) accent else Color(0xFF3B3F57), CircleShape)
            .clickable(enabled = enabled, interactionSource = interactions, indication = null, role = Role.Button, onClick = onClick)
            .alpha(if (enabled) 1f else 0.48f)
            .padding(horizontal = 20.dp, vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (primary) Ink else Frost, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun SettingChoice(title: String, subtitle: String, selected: Boolean, onClick: () -> Unit) {
    TactileCard(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title, color = Frost, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Text(subtitle, color = Muted, fontSize = 10.sp, lineHeight = 13.sp)
            }
            Spacer(Modifier.width(8.dp))
            Box(
                Modifier.size(20.dp).clip(CircleShape)
                    .background(if (selected) Cyan else Color.Transparent)
                    .border(1.5.dp, if (selected) Cyan else Muted, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (selected) Box(Modifier.size(6.dp).clip(CircleShape).background(Ink))
            }
        }
    }
}

@Composable
private fun UpdateCard(update: UpdateUiState, onClick: () -> Unit) {
    val releaseName = update.release?.versionName
    val title = when (update.stage) {
        UpdateStage.IDLE -> "Check for updates"
        UpdateStage.CHECKING -> "Checking for updates…"
        UpdateStage.AVAILABLE -> "Update to v$releaseName"
        UpdateStage.DOWNLOADING -> "Downloading v$releaseName…"
        UpdateStage.READY -> "Install v$releaseName"
        UpdateStage.CURRENT -> "Version ${BuildConfig.VERSION_NAME}"
        UpdateStage.ERROR -> "Update unavailable"
    }
    val subtitle = when (update.stage) {
        UpdateStage.IDLE -> "Signed builds from GitHub · no Play account"
        UpdateStage.CHECKING -> "Contacting the release server"
        UpdateStage.AVAILABLE -> "Tap to download and install"
        UpdateStage.DOWNLOADING -> if (update.progress > 0) "Verified download · ${update.progress}%" else "Starting verified download"
        UpdateStage.READY -> update.message ?: "Tap to open the system installer"
        UpdateStage.CURRENT -> update.message ?: "Tap to check again"
        UpdateStage.ERROR -> "${update.message ?: "Could not check"} · tap to retry"
    }
    val glyph = when (update.stage) {
        UpdateStage.CURRENT -> "✓"
        UpdateStage.ERROR -> "!"
        UpdateStage.CHECKING, UpdateStage.DOWNLOADING -> "·"
        else -> "↓"
    }
    val accent = when (update.stage) {
        UpdateStage.CURRENT -> Mint
        UpdateStage.ERROR -> Coral
        else -> Cyan
    }
    val actionable = update.stage != UpdateStage.CHECKING && update.stage != UpdateStage.DOWNLOADING
    TactileCard(onClick = onClick, modifier = Modifier.fillMaxWidth(), enabled = actionable) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(28.dp).clip(CircleShape).background(accent.copy(alpha = 0.14f))
                    .border(1.dp, accent.copy(alpha = 0.72f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(glyph, color = accent, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(title, color = Frost, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Text(subtitle, color = Muted, fontSize = 10.sp, lineHeight = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, color = Violet, fontSize = 9.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp, modifier = Modifier.padding(start = 8.dp, top = 4.dp))
}

@Composable
private fun ScreenHeader(title: String, onBack: () -> Unit, horizontalPadding: Dp = 50.dp) {
    Box(Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 5.dp)) {
        Text(
            title,
            color = Frost,
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.align(Alignment.Center),
        )
        Box(Modifier.align(Alignment.CenterStart).padding(start = horizontalPadding)) {
            TactileCard(onClick = onBack) {
                Box(Modifier.size(32.dp), contentAlignment = Alignment.Center) {
                    Text("‹", color = Frost, fontSize = 22.sp)
                }
            }
        }
    }
}

@Composable
private fun StatusDot(status: SessionStatus) {
    val color = when (status) {
        SessionStatus.ACTIVE -> Cyan
        SessionStatus.IDLE -> Mint
        SessionStatus.ERROR -> Coral
        SessionStatus.NOT_LOADED -> Muted
    }
    Box(Modifier.size(11.dp).clip(CircleShape).background(color.copy(alpha = 0.18f)).border(2.dp, color, CircleShape))
}

@Composable
private fun ErrorPill(message: String, modifier: Modifier = Modifier) {
    Text(
        message,
        color = Frost,
        fontSize = 10.sp,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        textAlign = TextAlign.Center,
        modifier = modifier.clip(CircleShape).background(Color(0xFF5A2431)).border(1.dp, Coral, CircleShape)
            .padding(horizontal = 13.dp, vertical = 7.dp),
    )
}

@Composable
private fun EmptyState(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, color = Frost, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(5.dp))
        Text(body, color = Muted, fontSize = 11.sp, textAlign = TextAlign.Center)
    }
}

private val SessionStatus.label: String
    get() = when (this) {
        SessionStatus.ACTIVE -> "Working"
        SessionStatus.IDLE -> "Ready"
        SessionStatus.NOT_LOADED -> "Available"
        SessionStatus.ERROR -> "Needs attention"
    }
