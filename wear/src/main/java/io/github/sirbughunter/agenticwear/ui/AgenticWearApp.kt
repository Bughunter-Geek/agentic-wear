@file:Suppress("LongMethod")

package io.github.sirbughunter.agenticwear.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
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
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalConfiguration
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
import androidx.wear.compose.foundation.requestFocusOnHierarchyActive
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable
import io.github.sirbughunter.agenticwear.BuildConfig
import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AlertKind
import io.github.sirbughunter.agenticwear.model.ApprovalMode
import io.github.sirbughunter.agenticwear.model.ChatPhase
import io.github.sirbughunter.agenticwear.model.SessionStatus
import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import io.github.sirbughunter.agenticwear.update.UpdateStage
import io.github.sirbughunter.agenticwear.update.UpdateUiState
import java.text.DateFormat
import java.util.Date
import androidx.wear.compose.material3.Text
import kotlinx.coroutines.launch

private val AgenticEaseOut = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)
private val AgenticEaseInOut = CubicBezierEasing(0.77f, 0f, 0.175f, 1f)
private val SurfaceShape = RoundedCornerShape(24.dp)

@Composable
fun AgenticWearApp(
    viewModel: AgenticWearViewModel,
    onPushToTalk: () -> Unit,
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
                    onPushToTalk = onPushToTalk,
                    onSessions = { viewModel.navigate(WearScreen.SESSIONS) },
                    onChat = viewModel::openSelectedChat,
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
                    onBack = viewModel::discardTranscript,
                    onTextChanged = viewModel::updateTranscript,
                    onSend = viewModel::submitTranscript,
                    onRevise = viewModel::reviseTranscript,
                )
                WearScreen.CHAT -> ChatScreen(
                    state = state,
                    onBack = { viewModel.navigate(WearScreen.HOME) },
                    onReply = {
                        viewModel.replyFromChat()
                        onPushToTalk()
                    },
                    onRetry = viewModel::retryChat,
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
        state.error?.takeIf {
            state.screen != WearScreen.PAIR && state.screen != WearScreen.CHAT && state.screen != WearScreen.TRANSCRIPT
        }?.let { error ->
            val horizontalPadding = roundAwareHorizontalPadding(round = 28.dp, square = 16.dp)
            val bottomPadding = if (LocalConfiguration.current.isScreenRound) 40.dp else 16.dp
            ErrorPill(
                error,
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .padding(horizontal = horizontalPadding)
                    .padding(bottom = bottomPadding),
            )
        }
        AnimatedVisibility(
            visible = state.showInstallPermissionPrompt,
            enter = fadeIn(tween(180, easing = AgenticEaseOut)) +
                scaleIn(tween(200, easing = AgenticEaseOut), initialScale = 0.94f),
            exit = fadeOut(tween(130, easing = AgenticEaseOut)) +
                scaleOut(tween(130, easing = AgenticEaseOut), targetScale = 0.97f),
        ) {
            InstallPermissionPrompt(
                onContinue = viewModel::continueInstallAfterWarning,
                onDismiss = viewModel::dismissInstallPermissionPrompt,
            )
        }
    }
}

@Composable
private fun InstallPermissionPrompt(
    onContinue: () -> Unit,
    onDismiss: () -> Unit,
) {
    val blockerInteractions = remember { MutableInteractionSource() }
    val horizontalPadding = roundAwareHorizontalPadding(round = 30.dp, square = 20.dp)
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
            .padding(horizontal = horizontalPadding),
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
                "Continue to Android’s installer. If it blocks the update, tap Settings there and allow Agentic Wear. Your data stays intact.",
                color = Muted,
                fontSize = 10.sp,
                lineHeight = 13.sp,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(8.dp))
            ActionButton(
                label = "Continue",
                primary = true,
                onClick = onContinue,
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
    onPushToTalk: () -> Unit,
    onSessions: () -> Unit,
    onChat: () -> Unit,
    onSettings: () -> Unit,
    onAlert: () -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val compact = maxHeight < 420.dp
        val orbSize = if (compact) 68.dp else 148.dp
        val horizontalPadding = roundAwareHorizontalPadding(
            round = if (compact) 24.dp else 30.dp,
            square = if (compact) 16.dp else 20.dp,
        )
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = horizontalPadding),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(if (compact) 8.dp else 22.dp))
            ConnectionPill(connected = state.isPaired)
            Spacer(Modifier.height(if (compact) 4.dp else 8.dp))
            TactileCard(
                onClick = if (state.selectedSession == null) onSessions else onChat,
                modifier = Modifier.fillMaxWidth(),
            ) {
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
                transcribing = state.transcribing,
                transcriptionElapsedMillis = state.transcriptionElapsedMillis,
                pending = state.pending,
                voiceLevel = state.voiceLevel,
                enabled = state.isPaired && !state.pending,
                onToggle = onPushToTalk,
            )
            Text(
                text = when {
                    state.recording -> "Tap again to transcribe"
                    state.transcribing -> state.transcriptionElapsedMillis?.let { elapsedMillis ->
                        "Transcribing · ${formatTranscriptionElapsed(elapsedMillis)}"
                    } ?: "Transcribing audio…"
                    state.pending -> "Agentic Wear is working…"
                    else -> "Tap to talk"
                },
                color = when {
                    state.recording -> Cyan
                    state.transcribing -> Violet
                    else -> Muted
                },
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
    transcribing: Boolean,
    transcriptionElapsedMillis: Long?,
    pending: Boolean,
    voiceLevel: Float,
    enabled: Boolean,
    onToggle: () -> Unit,
) {
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val haptics = LocalHapticFeedback.current
    val compact = size <= 80.dp
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.96f else 1f,
        animationSpec = tween(140, easing = AgenticEaseOut),
        label = "voice control press",
    )
    val activity by animateFloatAsState(
        targetValue = if (recording) voiceLevel.coerceIn(0f, 1f) else 0f,
        animationSpec = tween(100, easing = LinearEasing),
        label = "live voice activity",
    )
    val activityHaloSize = size + if (compact) 28.dp else 52.dp
    Box(contentAlignment = Alignment.Center, modifier = Modifier.size(activityHaloSize)) {
        AnimatedVisibility(
            visible = transcribing,
            enter = fadeIn(tween(180, easing = AgenticEaseOut)) +
                scaleIn(tween(180, easing = AgenticEaseOut), initialScale = 0.94f),
            exit = fadeOut(tween(140, easing = AgenticEaseOut)) +
                scaleOut(tween(140, easing = AgenticEaseOut), targetScale = 0.96f),
        ) {
            TranscribingIndicator(size + if (compact) 10.dp else 16.dp)
        }
        VoiceActivityHalo(size = activityHaloSize, activity = activity)
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
                    contentDescription = when {
                        recording -> "Stop recording and transcribe"
                        transcribing -> transcriptionElapsedMillis?.let { elapsedMillis ->
                            "Transcribing audio, ${formatTranscriptionElapsed(elapsedMillis)} elapsed"
                        } ?: "Transcribing audio"
                        else -> "Start recording for the selected agent"
                    }
                    role = Role.Button
                }
                .clickable(
                    enabled = enabled,
                    interactionSource = interactions,
                    indication = null,
                    role = Role.Button,
                ) {
                    haptics.performHapticFeedback(
                        if (recording) HapticFeedbackType.GestureEnd else HapticFeedbackType.ToggleOn,
                    )
                    onToggle()
                }
                .alpha(if (enabled) 1f else 0.55f),
            contentAlignment = Alignment.Center,
        ) {
            AgentGlyph(
                recording = recording,
                pending = pending,
                voiceLevel = activity,
                modifier = Modifier.size(size * 0.48f),
            )
        }
    }
}

@Composable
private fun VoiceActivityHalo(size: Dp, activity: Float) {
    Canvas(
        Modifier
            .size(size)
            .graphicsLayer {
                val activityScale = 0.78f + activity * 0.22f
                scaleX = activityScale
                scaleY = activityScale
                alpha = (activity * 1.4f).coerceIn(0f, 1f)
            },
    ) {
        val stroke = this.size.minDimension * 0.025f
        drawArc(
            color = Violet.copy(alpha = 0.22f),
            startAngle = 127.5f,
            sweepAngle = 285f,
            useCenter = false,
            style = Stroke(stroke * 2.4f, cap = StrokeCap.Round),
        )
        drawArc(
            brush = Brush.sweepGradient(listOf(Cyan, Violet, Frost, Cyan)),
            startAngle = 127.5f,
            sweepAngle = 285f,
            useCenter = false,
            style = Stroke(stroke, cap = StrokeCap.Round),
        )
    }
}

@Composable
private fun TranscribingIndicator(size: Dp) {
    val transition = rememberInfiniteTransition(label = "transcribing indicator")
    val glow by transition.animateFloat(
        initialValue = 0.28f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(900, easing = AgenticEaseInOut),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "transcribing glow",
    )
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = this.size.minDimension * 0.035f
            drawArc(
                color = Violet.copy(alpha = 0.34f),
                startAngle = 127.5f,
                sweepAngle = 285f,
                useCenter = false,
                style = Stroke(stroke * 1.5f, cap = StrokeCap.Round),
            )
        }
        Canvas(
            Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = glow },
        ) {
            val stroke = this.size.minDimension * 0.035f
            drawArc(
                brush = Brush.sweepGradient(listOf(Cyan, Violet, Frost, Cyan)),
                startAngle = 127.5f,
                sweepAngle = 285f,
                useCenter = false,
                style = Stroke(stroke, cap = StrokeCap.Round),
            )
        }
    }
}

@Composable
private fun AgentGlyph(
    recording: Boolean,
    pending: Boolean,
    voiceLevel: Float = 0f,
    modifier: Modifier = Modifier,
) {
    val activity = if (recording) voiceLevel.coerceIn(0f, 1f) else 0f
    val accent = when {
        recording -> Cyan
        pending -> Violet
        else -> Frost
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    val arcScale = VoiceGlyphGeometry.arcScale(activity)
                    scaleX = arcScale
                    scaleY = arcScale
                },
        ) {
            val w = size.width
            val h = size.height
            drawArc(
                brush = Brush.sweepGradient(listOf(Cyan, Violet, Cyan)),
                startAngle = 127.5f,
                sweepAngle = 285f,
                useCenter = false,
                topLeft = Offset(
                    w * VoiceGlyphGeometry.ARC_INSET_FRACTION,
                    h * VoiceGlyphGeometry.ARC_INSET_FRACTION,
                ),
                size = androidx.compose.ui.geometry.Size(
                    w * VoiceGlyphGeometry.ARC_DIAMETER_FRACTION,
                    h * VoiceGlyphGeometry.ARC_DIAMETER_FRACTION,
                ),
                style = Stroke(w * VoiceGlyphGeometry.ARC_STROKE_FRACTION, cap = StrokeCap.Round),
            )
        }
        Canvas(Modifier.fillMaxSize()) {
            val w = size.width
            val h = size.height
            val strokeWidth = w * VoiceGlyphGeometry.BAR_STROKE_FRACTION
            repeat(VoiceGlyphGeometry.BAR_COUNT) { index ->
                val x = w * VoiceGlyphGeometry.barXFraction(index)
                val barHeight = h * VoiceGlyphGeometry.barHeightFraction(index, activity)
                drawLine(
                    color = if (index == 1) accent else if (index == 0) Cyan else Violet,
                    start = Offset(x, (h - barHeight) / 2f),
                    end = Offset(x, (h + barHeight) / 2f),
                    strokeWidth = strokeWidth,
                    cap = StrokeCap.Round,
                )
            }
        }
    }
}

@Composable
private fun SessionsScreen(state: WearUiState, onBack: () -> Unit, onSelect: (String) -> Unit) {
    val listState = rememberLazyListState()
    val rotaryFocusRequester = remember { FocusRequester() }
    val horizontalPadding = roundAwareHorizontalPadding()
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Sessions", onBack)
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .requestFocusOnHierarchyActive()
                .rotaryScrollable(
                    behavior = RotaryScrollableDefaults.behavior(listState),
                    focusRequester = rotaryFocusRequester,
                ),
            state = listState,
            contentPadding = PaddingValues(
                start = horizontalPadding,
                end = horizontalPadding,
                bottom = 36.dp,
            ),
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
    onRevise: () -> Unit,
) {
    val transcript = state.transcript
    val scrollState = rememberScrollState()
    val rotaryFocusRequester = remember { FocusRequester() }
    val horizontalPadding = roundAwareHorizontalPadding()
    Column(
        Modifier
            .fillMaxSize()
            .requestFocusOnHierarchyActive()
            .rotaryScrollable(
                behavior = RotaryScrollableDefaults.behavior(scrollState),
                focusRequester = rotaryFocusRequester,
            )
            .verticalScroll(scrollState)
            .padding(horizontal = horizontalPadding),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        ScreenHeader("Review", onBack, horizontalPadding = 28.dp)
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Your prompt", color = Cyan, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            state.transcriptionElapsedMillis?.let { elapsedMillis ->
                val elapsedLabel = formatTranscriptionElapsed(elapsedMillis)
                Text(
                    "Took $elapsedLabel",
                    color = Violet,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    modifier = Modifier.semantics {
                        contentDescription = "Transcribed in $elapsedLabel"
                    },
                )
            }
        }
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
        if (transcript?.revised == true) {
            Spacer(Modifier.height(4.dp))
            Text(
                "Smart revision applied",
                color = Mint,
                fontSize = 9.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        state.error?.let {
            Spacer(Modifier.height(7.dp))
            ErrorPill(it, Modifier.fillMaxWidth())
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionButton(
                if (state.transcriptionEngine == TranscriptionEngine.BRIDGE_WHISPER) "Revise" else "Redo",
                false,
                onRevise,
                enabled = !state.pending,
            )
            ActionButton(if (state.pending) "Sending…" else "Send", true, onSend, enabled = !state.pending && !transcript?.text.isNullOrBlank())
        }
        if (state.transcriptionEngine == TranscriptionEngine.BRIDGE_WHISPER) {
            Spacer(Modifier.height(7.dp))
            Text(
                "Revise uses your private Codex bridge to replace conflicting details.",
                color = Muted,
                fontSize = 9.sp,
                lineHeight = 12.sp,
                textAlign = TextAlign.Center,
            )
        }
        Spacer(Modifier.height(48.dp))
    }
}

@Composable
private fun ChatScreen(
    state: WearUiState,
    onBack: () -> Unit,
    onReply: () -> Unit,
    onRetry: () -> Unit,
) {
    val listState = rememberLazyListState()
    val rotaryFocusRequester = remember { FocusRequester() }
    val horizontalPadding = roundAwareHorizontalPadding(round = 27.dp, square = 18.dp)
    val chat = state.chat
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Live session", onBack)
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .requestFocusOnHierarchyActive()
                .rotaryScrollable(
                    behavior = RotaryScrollableDefaults.behavior(listState),
                    focusRequester = rotaryFocusRequester,
                ),
            state = listState,
            contentPadding = PaddingValues(
                start = horizontalPadding,
                end = horizontalPadding,
                bottom = 42.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 5.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        chat?.title ?: state.selectedSession?.title ?: "Codex session",
                        color = Frost,
                        fontSize = 14.sp,
                        lineHeight = 17.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(3.dp))
                    Text(
                        when {
                            state.pending && chat == null -> "Loading recent replies…"
                            chat?.status == SessionStatus.ACTIVE -> "Live · agent working"
                            chat != null -> "Live · ready for your reply"
                            else -> "Waiting for the private bridge"
                        },
                        color = if (chat?.status == SessionStatus.ACTIVE) Cyan else Muted,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
            state.error?.let { message ->
                item { ErrorPill(message, Modifier.fillMaxWidth()) }
            }
            if (chat?.paragraphs.isNullOrEmpty()) {
                item {
                    EmptyState(
                        "No assistant text yet",
                        "Tap Voice reply to start or continue this Codex session.",
                    )
                }
            } else {
                items(chat.paragraphs, key = { it.id }) { paragraph ->
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .clip(SurfaceShape)
                            .background(if (paragraph.phase == ChatPhase.FINAL_ANSWER) PanelRaised else Panel)
                            .border(
                                1.dp,
                                if (paragraph.phase == ChatPhase.FINAL_ANSWER) Violet.copy(alpha = 0.48f) else Color(0xFF34384D),
                                SurfaceShape,
                            )
                            .padding(horizontal = 13.dp, vertical = 10.dp),
                    ) {
                        Column {
                            Text(
                                if (paragraph.phase == ChatPhase.FINAL_ANSWER) "ANSWER" else "UPDATE",
                                color = if (paragraph.phase == ChatPhase.FINAL_ANSWER) Violet else Cyan,
                                fontSize = 8.sp,
                                fontWeight = FontWeight.ExtraBold,
                                letterSpacing = 0.7.sp,
                            )
                            Spacer(Modifier.height(3.dp))
                            Text(
                                paragraph.text,
                                color = Frost,
                                fontSize = 12.sp,
                                lineHeight = 16.sp,
                            )
                        }
                    }
                }
            }
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                ) {
                    ActionButton("Retry", false, onRetry, enabled = !state.pending)
                    ActionButton("Voice reply", true, onReply, enabled = !state.pending)
                }
            }
        }
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
    val scrollState = rememberScrollState()
    val rotaryFocusRequester = remember { FocusRequester() }
    val horizontalPadding = roundAwareHorizontalPadding(round = 30.dp, square = 20.dp)
    Column(
        Modifier
            .fillMaxSize()
            .requestFocusOnHierarchyActive()
            .rotaryScrollable(
                behavior = RotaryScrollableDefaults.behavior(scrollState),
                focusRequester = rotaryFocusRequester,
            )
            .verticalScroll(scrollState)
            .padding(horizontal = horizontalPadding),
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
    val listState = rememberLazyListState()
    val rotaryFocusRequester = remember { FocusRequester() }
    val horizontalPadding = roundAwareHorizontalPadding()
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Settings", onBack)
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .requestFocusOnHierarchyActive()
                .rotaryScrollable(
                    behavior = RotaryScrollableDefaults.behavior(listState),
                    focusRequester = rotaryFocusRequester,
                ),
            state = listState,
            contentPadding = PaddingValues(
                start = horizontalPadding,
                end = horizontalPadding,
                bottom = 36.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            item { SectionLabel("TRANSCRIPTION") }
            item {
                SettingChoice(
                    title = "Private Whisper",
                    subtitle = "Free · multilingual · runs on your Mac",
                    selected = state.transcriptionEngine == TranscriptionEngine.BRIDGE_WHISPER,
                ) { onEngine(TranscriptionEngine.BRIDGE_WHISPER) }
            }
            item {
                SettingChoice(
                    title = "Device speech",
                    subtitle = "Faster · limited language switching",
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
                item { SectionLabel("BUILD STATUS") }
                item { BuildStatusCard() }
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
                    "${BuildConfig.RELEASE_CHANNEL} ${BuildConfig.VERSION_NAME} · build ${BuildConfig.VERSION_CODE}",
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
    val scrollState = rememberScrollState()
    val rotaryFocusRequester = remember { FocusRequester() }
    val horizontalPadding = roundAwareHorizontalPadding(round = 30.dp, square = 20.dp)
    Column(
        Modifier
            .fillMaxSize()
            .requestFocusOnHierarchyActive()
            .rotaryScrollable(
                behavior = RotaryScrollableDefaults.behavior(scrollState),
                focusRequester = rotaryFocusRequester,
            )
            .verticalScroll(scrollState)
            .padding(horizontal = horizontalPadding),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(8.dp))
        AgentGlyph(recording = false, pending = false, modifier = Modifier.size(40.dp))
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
private fun BuildStatusCard() {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(SurfaceShape)
            .background(Brush.linearGradient(listOf(PanelRaised, Panel)))
            .border(1.dp, Amber.copy(alpha = 0.72f), SurfaceShape)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(28.dp)
                .clip(CircleShape)
                .background(Amber.copy(alpha = 0.14f))
                .border(1.dp, Amber.copy(alpha = 0.72f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text("α", color = Amber, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                "${BuildConfig.RELEASE_CHANNEL} ${BuildConfig.VERSION_NAME}",
                color = Frost,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                "Testing build · not stable",
                color = Amber,
                fontSize = 10.sp,
                lineHeight = 13.sp,
            )
        }
    }
}

@Composable
private fun UpdateCard(update: UpdateUiState, onClick: () -> Unit) {
    val releaseName = update.release?.versionName
    val releaseLabel = "${BuildConfig.RELEASE_CHANNEL} $releaseName"
    val title = when (update.stage) {
        UpdateStage.IDLE -> "Check for updates"
        UpdateStage.CHECKING -> "Checking for updates…"
        UpdateStage.AVAILABLE -> "Update to $releaseLabel"
        UpdateStage.DOWNLOADING -> "Downloading $releaseLabel…"
        UpdateStage.READY -> "Install $releaseLabel"
        UpdateStage.CURRENT -> "${BuildConfig.RELEASE_CHANNEL} ${BuildConfig.VERSION_NAME}"
        UpdateStage.ERROR -> "Update unavailable"
    }
    val subtitle = when (update.stage) {
        UpdateStage.IDLE -> "Signed ${BuildConfig.RELEASE_CHANNEL.lowercase()} builds from GitHub"
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
private fun roundAwareHorizontalPadding(
    round: Dp = 28.dp,
    square: Dp = 18.dp,
): Dp = if (LocalConfiguration.current.isScreenRound) round else square

@Composable
private fun ScreenHeader(title: String, onBack: () -> Unit, horizontalPadding: Dp = 50.dp) {
    val round = LocalConfiguration.current.isScreenRound
    Box(Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 5.dp)) {
        Text(
            title,
            color = Frost,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .fillMaxWidth()
                .padding(
                    start = if (round) 84.dp else 72.dp,
                    end = if (round) 42.dp else 72.dp,
                )
                .align(Alignment.Center),
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
        lineHeight = 13.sp,
        maxLines = 4,
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
