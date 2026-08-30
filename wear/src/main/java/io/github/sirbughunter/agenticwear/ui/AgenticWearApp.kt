@file:Suppress("LongMethod")

package io.github.sirbughunter.agenticwear.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.SizeTransform
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
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Speed
import androidx.compose.material.icons.rounded.ThumbDown
import androidx.compose.material.icons.rounded.ThumbUp
import androidx.compose.material.icons.rounded.TouchApp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.requestFocusOnHierarchyActive
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable
import io.github.sirbughunter.agenticwear.BuildConfig
import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AlertKind
import io.github.sirbughunter.agenticwear.model.ApprovalMode
import io.github.sirbughunter.agenticwear.model.ChatDisplayPolicy
import io.github.sirbughunter.agenticwear.model.ChatMessage
import io.github.sirbughunter.agenticwear.model.ChatMessageKind
import io.github.sirbughunter.agenticwear.model.ChatPhase
import io.github.sirbughunter.agenticwear.model.ChatRole
import io.github.sirbughunter.agenticwear.model.FeedbackRating
import io.github.sirbughunter.agenticwear.model.ModelOption
import io.github.sirbughunter.agenticwear.model.ReasoningEffortPolicy
import io.github.sirbughunter.agenticwear.model.SessionStatus
import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import io.github.sirbughunter.agenticwear.update.UpdateStage
import io.github.sirbughunter.agenticwear.update.UpdateUiState
import java.text.DateFormat
import java.util.Date
import kotlin.math.roundToInt
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val AgenticEaseOut = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)
private val AgenticEaseInOut = CubicBezierEasing(0.77f, 0f, 0.175f, 1f)
private val SurfaceShape = RoundedCornerShape(24.dp)
private const val SelectorMotionDurationMillis = 200
private const val SelectorClosedScale = 0.95f
private const val UpdateCollapseDurationMillis = 200

private fun selectorEnterTransition(transformOrigin: TransformOrigin): EnterTransition =
    fadeIn(tween(SelectorMotionDurationMillis, easing = AgenticEaseOut)) +
        scaleIn(
            animationSpec = tween(SelectorMotionDurationMillis, easing = AgenticEaseOut),
            initialScale = SelectorClosedScale,
            transformOrigin = transformOrigin,
        )

private fun selectorExitTransition(transformOrigin: TransformOrigin): ExitTransition =
    fadeOut(tween(SelectorMotionDurationMillis, easing = AgenticEaseOut)) +
        scaleOut(
            animationSpec = tween(SelectorMotionDurationMillis, easing = AgenticEaseOut),
            targetScale = SelectorClosedScale,
            transformOrigin = transformOrigin,
        )

private fun selectorTransformOrigin(
    triggerPosition: Offset,
    triggerSize: IntSize,
    containerSize: IntSize,
): TransformOrigin {
    if (containerSize.width <= 0 || containerSize.height <= 0) {
        return TransformOrigin(0.5f, 0.5f)
    }
    val triggerCenterX = triggerPosition.x + triggerSize.width / 2f
    val triggerCenterY = triggerPosition.y + triggerSize.height / 2f
    return TransformOrigin(
        pivotFractionX = (triggerCenterX / containerSize.width.toFloat()).coerceIn(0f, 1f),
        pivotFractionY = (triggerCenterY / containerSize.height.toFloat()).coerceIn(0f, 1f),
    )
}

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
                    onModel = viewModel::setModel,
                    onEffort = viewModel::setReasoningEffort,
                    onApprovalMode = viewModel::setApprovalMode,
                    onRefreshSessions = viewModel::refreshSessionsForRecovery,
                    onStartNewSession = viewModel::startNewSessionForRecovery,
                )
                WearScreen.CHAT -> ChatScreen(
                    state = state,
                    onBack = { viewModel.navigate(WearScreen.HOME) },
                    onReply = {
                        viewModel.replyFromChat()
                        onPushToTalk()
                    },
                    onRetry = viewModel::retryChat,
                    onRateMessage = viewModel::rateChatMessage,
                    onPermissionResponse = viewModel::respondToChatPermission,
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
                    onCollapseUpdates = viewModel::setCollapseUpdates,
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
                .height(220.dp)
                .clip(SurfaceShape)
                .background(Brush.linearGradient(listOf(PanelRaised, Panel)))
                .border(1.dp, Violet.copy(alpha = 0.72f), SurfaceShape)
                .verticalScroll(rememberScrollState())
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
    onModel: (String?) -> Unit,
    onEffort: (String) -> Unit,
    onApprovalMode: (ApprovalMode) -> Unit,
    onRefreshSessions: () -> Unit,
    onStartNewSession: () -> Unit,
) {
    val transcript = state.transcript
    val scrollState = rememberScrollState()
    val rotaryFocusRequester = remember { FocusRequester() }
    val horizontalPadding = roundAwareHorizontalPadding()
    var modelSelectorOpen by rememberSaveable { mutableStateOf(false) }
    var approvalSelectorOpen by rememberSaveable { mutableStateOf(false) }
    var selectorContainerSize by remember { mutableStateOf(IntSize.Zero) }
    var modelSelectorOrigin by remember { mutableStateOf(TransformOrigin(0.5f, 0.5f)) }
    var approvalSelectorOrigin by remember { mutableStateOf(TransformOrigin(0.5f, 0.5f)) }
    val selectorOpen = modelSelectorOpen || approvalSelectorOpen
    val selectedModel = state.models.firstOrNull { it.model == state.selectedModel }
    val modelLabel = selectedModel?.displayName ?: state.selectedModel ?: "Auto"
    Box(
        Modifier
            .fillMaxSize()
            .onSizeChanged { selectorContainerSize = it },
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .semantics {
                    if (selectorOpen) hideFromAccessibility()
                }
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
                transcriptDestinationLabel(state),
                color = Muted,
                fontSize = 10.sp,
                lineHeight = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
            )
            Spacer(Modifier.height(4.dp))
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ReasoningControl(
                    effort = state.reasoningEffort,
                    modelLabel = modelLabel,
                    onClick = {
                        approvalSelectorOpen = false
                        modelSelectorOpen = true
                    },
                    modifier = Modifier
                        .weight(1f)
                        .onGloballyPositioned { coordinates ->
                            modelSelectorOrigin = selectorTransformOrigin(
                                triggerPosition = coordinates.positionInRoot(),
                                triggerSize = coordinates.size,
                                containerSize = selectorContainerSize,
                            )
                        },
                )
                Spacer(Modifier.width(6.dp))
                ApprovalModeControl(
                    approvalMode = state.approvalMode,
                    onClick = {
                        modelSelectorOpen = false
                        approvalSelectorOpen = true
                    },
                    modifier = Modifier.onGloballyPositioned { coordinates ->
                        approvalSelectorOrigin = selectorTransformOrigin(
                            triggerPosition = coordinates.positionInRoot(),
                            triggerSize = coordinates.size,
                            containerSize = selectorContainerSize,
                        )
                    },
                )
            }
            if (transcript?.revised == true) {
                Spacer(Modifier.height(4.dp))
                Text(
                    "Smart revision applied",
                    color = Mint,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            state.error?.let { error ->
                Spacer(Modifier.height(7.dp))
                ErrorPill(error, Modifier.fillMaxWidth())
                val recoveryActions = recoveryActionsForError(error)
                if (ErrorRecoveryAction.REFRESH_SESSIONS in recoveryActions) {
                    Spacer(Modifier.height(7.dp))
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        ActionButton("Refresh sessions", false, onRefreshSessions, enabled = !state.pending)
                        Spacer(Modifier.height(6.dp))
                        ActionButton("Start new", true, onStartNewSession, enabled = !state.pending)
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Refresh confirms the selected session. Start new keeps this draft and sends nowhere until you tap Send.",
                        color = Muted,
                        fontSize = 9.sp,
                        lineHeight = 12.sp,
                        textAlign = TextAlign.Center,
                    )
                }
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
        AnimatedVisibility(
            visible = modelSelectorOpen,
            modifier = Modifier.fillMaxSize(),
            enter = selectorEnterTransition(modelSelectorOrigin),
            exit = selectorExitTransition(modelSelectorOrigin),
        ) {
            ModelEffortOverlay(
                state = state,
                onDismiss = { modelSelectorOpen = false },
                onModel = onModel,
                onEffort = onEffort,
            )
        }
        AnimatedVisibility(
            visible = approvalSelectorOpen,
            modifier = Modifier.fillMaxSize(),
            enter = selectorEnterTransition(approvalSelectorOrigin),
            exit = selectorExitTransition(approvalSelectorOrigin),
        ) {
            ApprovalModeOverlay(
                approvalMode = state.approvalMode,
                onDismiss = { approvalSelectorOpen = false },
                onApprovalMode = { approvalMode ->
                    onApprovalMode(approvalMode)
                    approvalSelectorOpen = false
                },
            )
        }
    }
}

@Composable
private fun ReasoningControl(
    effort: String,
    modelLabel: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val effortLabel = ReasoningEffortPolicy.label(effort)
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val haptics = LocalHapticFeedback.current
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.96f else 1f,
        animationSpec = tween(120, easing = AgenticEaseOut),
        label = "reasoning control press",
    )
    Row(
        modifier
            .height(48.dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(CircleShape)
            .background(Color(0xFF17171E).copy(alpha = 0.96f))
            .border(1.dp, Color.White.copy(alpha = 0.14f), CircleShape)
            .semantics {
                contentDescription = "$effortLabel reasoning effort. $modelLabel model. Open model and effort controls"
            }
            .clickable(
                interactionSource = interactions,
                indication = null,
                role = Role.Button,
            ) {
                haptics.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
                onClick()
            }
            .padding(start = 6.dp, end = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(30.dp)
                .clip(CircleShape)
                .background(Violet.copy(alpha = 0.12f))
                .border(1.dp, Violet.copy(alpha = 0.34f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Rounded.Speed,
                contentDescription = null,
                tint = Violet,
                modifier = Modifier.size(18.dp),
            )
        }
        Spacer(Modifier.width(5.dp))
        Text(effortLabel, color = Frost, fontSize = 9.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.weight(1f))
        Icon(
            imageVector = Icons.Rounded.KeyboardArrowDown,
            contentDescription = null,
            tint = Muted,
            modifier = Modifier.size(15.dp),
        )
    }
}

@Composable
private fun ApprovalModeControl(
    approvalMode: ApprovalMode,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val haptics = LocalHapticFeedback.current
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.96f else 1f,
        animationSpec = tween(120, easing = AgenticEaseOut),
        label = "approval mode control press",
    )
    val label = approvalMode.label
    val accent = if (approvalMode == ApprovalMode.ALLOW_CONTROLS) Amber else Cyan
    Box(
        modifier
            .size(48.dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(CircleShape)
            .background(Color(0xFF17171E).copy(alpha = 0.96f))
            .border(1.dp, accent.copy(alpha = 0.42f), CircleShape)
            .semantics {
                contentDescription = "$label approval mode. Open approval mode controls"
                stateDescription = label
            }
            .clickable(
                interactionSource = interactions,
                indication = null,
                role = Role.Button,
            ) {
                haptics.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
                onClick()
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = if (approvalMode == ApprovalMode.ALLOW_CONTROLS) {
                Icons.Rounded.TouchApp
            } else {
                Icons.Rounded.NotificationsActive
            },
            contentDescription = null,
            tint = accent,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
private fun ApprovalModeOverlay(
    approvalMode: ApprovalMode,
    onDismiss: () -> Unit,
    onApprovalMode: (ApprovalMode) -> Unit,
) {
    val horizontalPadding = roundAwareHorizontalPadding(round = 34.dp, square = 20.dp)
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(
                            Color.Black.copy(alpha = 0.9f),
                            Color(0xFF07070A).copy(alpha = 0.97f),
                        ),
                    ),
                )
                .pointerInput(onDismiss) {
                    detectTapGestures(onTap = { onDismiss() })
                },
        )
        Column(
            Modifier
                .fillMaxSize()
                .padding(top = 8.dp, bottom = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(Modifier.fillMaxWidth().height(44.dp)) {
                Text(
                    text = "Permissions",
                    color = Frost,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.2).sp,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 60.dp)
                        .align(Alignment.Center),
                )
                Box(
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .padding(end = horizontalPadding - 6.dp)
                        .size(44.dp)
                        .clip(CircleShape)
                        .clickable(role = Role.Button, onClick = onDismiss)
                        .semantics { contentDescription = "Close approval mode controls" },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier
                            .size(30.dp)
                            .clip(CircleShape)
                            .background(Color.White.copy(alpha = 0.07f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Close,
                            contentDescription = null,
                            tint = Frost.copy(alpha = 0.78f),
                            modifier = Modifier.size(17.dp),
                        )
                    }
                }
            }
            Text(
                "Choose how the next approval reaches your wrist",
                color = Muted.copy(alpha = 0.86f),
                fontSize = 9.sp,
                lineHeight = 12.sp,
                textAlign = TextAlign.Center,
                maxLines = 2,
                modifier = Modifier.padding(horizontal = horizontalPadding),
            )
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = horizontalPadding),
                verticalArrangement = Arrangement.Center,
            ) {
                ApprovalModeChoice(
                    mode = ApprovalMode.ALERT_ONLY,
                    selected = approvalMode == ApprovalMode.ALERT_ONLY,
                    onClick = { onApprovalMode(ApprovalMode.ALERT_ONLY) },
                )
                Spacer(Modifier.height(7.dp))
                ApprovalModeChoice(
                    mode = ApprovalMode.ALLOW_CONTROLS,
                    selected = approvalMode == ApprovalMode.ALLOW_CONTROLS,
                    onClick = { onApprovalMode(ApprovalMode.ALLOW_CONTROLS) },
                )
            }
        }
    }
}

@Composable
private fun ApprovalModeChoice(
    mode: ApprovalMode,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val haptics = LocalHapticFeedback.current
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.97f else 1f,
        animationSpec = tween(120, easing = AgenticEaseOut),
        label = "approval mode choice press",
    )
    val accent = if (mode == ApprovalMode.ALLOW_CONTROLS) Amber else Cyan
    Row(
        Modifier
            .fillMaxWidth()
            .height(56.dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(RoundedCornerShape(18.dp))
            .background(if (selected) accent.copy(alpha = 0.12f) else Color(0xFF17181D))
            .border(
                width = 1.dp,
                color = if (selected) accent.copy(alpha = 0.82f) else Color.White.copy(alpha = 0.12f),
                shape = RoundedCornerShape(18.dp),
            )
            .semantics {
                this.selected = selected
                contentDescription = "${mode.label}. ${mode.description}"
                stateDescription = if (selected) "Selected" else "Not selected"
            }
            .clickable(
                interactionSource = interactions,
                indication = null,
                role = Role.RadioButton,
            ) {
                haptics.performHapticFeedback(HapticFeedbackType.ToggleOn)
                onClick()
            }
            .padding(horizontal = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(accent.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = if (mode == ApprovalMode.ALLOW_CONTROLS) {
                    Icons.Rounded.TouchApp
                } else {
                    Icons.Rounded.NotificationsActive
                },
                contentDescription = null,
                tint = accent,
                modifier = Modifier.size(18.dp),
            )
        }
        Spacer(Modifier.width(9.dp))
        Column(Modifier.weight(1f)) {
            Text(
                mode.label,
                color = Frost,
                fontSize = 11.sp,
                lineHeight = 13.sp,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
                maxLines = 1,
            )
            Text(
                mode.description,
                color = Muted.copy(alpha = if (selected) 0.92f else 0.76f),
                fontSize = 8.sp,
                lineHeight = 10.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (selected) {
            Spacer(Modifier.width(5.dp))
            Box(
                Modifier
                    .size(18.dp)
                    .clip(CircleShape)
                    .background(accent),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Rounded.Check,
                    contentDescription = null,
                    tint = Ink,
                    modifier = Modifier.size(12.dp),
                )
            }
        }
    }
}

private val ApprovalMode.label: String
    get() = when (this) {
        ApprovalMode.ALERT_ONLY -> "Alert only"
        ApprovalMode.ALLOW_CONTROLS -> "Allow controls"
    }

private val ApprovalMode.description: String
    get() = when (this) {
        ApprovalMode.ALERT_ONLY -> "Notify here; decide in Codex"
        ApprovalMode.ALLOW_CONTROLS -> "Decide for watch-owned sessions"
    }

@Composable
private fun ModelEffortOverlay(
    state: WearUiState,
    onDismiss: () -> Unit,
    onModel: (String?) -> Unit,
    onEffort: (String) -> Unit,
) {
    val selectedModel = state.models.firstOrNull { it.model == state.selectedModel }
    val effortOptions = ReasoningEffortPolicy.options(selectedModel)
    val selectedEffortIndex = effortOptions.indexOf(ReasoningEffortPolicy.normalize(state.reasoningEffort))
        .coerceIn(0, effortOptions.lastIndex)
    val modelOptions = listOf<ModelOption?>(null) + state.models
    val selectedModelIndex = modelOptions.indexOfFirst { option ->
        option?.model == state.selectedModel || option == null && state.selectedModel == null
    }.coerceAtLeast(0)
    val modelListState = rememberLazyListState(initialFirstVisibleItemIndex = selectedModelIndex)
    val scope = rememberCoroutineScope()
    val horizontalPadding = roundAwareHorizontalPadding(round = 28.dp, square = 18.dp)
    val effortLabel = ReasoningEffortPolicy.label(state.reasoningEffort)
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(
                            Color.Black.copy(alpha = 0.9f),
                            Color(0xFF07070A).copy(alpha = 0.97f),
                        ),
                    ),
                )
                .pointerInput(onDismiss) {
                    detectTapGestures(onTap = { onDismiss() })
                },
        )
        Column(
            Modifier
                .fillMaxSize()
                .padding(top = 8.dp, bottom = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(Modifier.fillMaxWidth().height(44.dp)) {
                Text(
                    text = effortLabel,
                    color = Violet,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    letterSpacing = (-0.25).sp,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 62.dp)
                        .align(Alignment.Center),
                )
                Box(
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .padding(end = horizontalPadding - 4.dp)
                        .size(44.dp)
                        .clip(CircleShape)
                        .clickable(role = Role.Button, onClick = onDismiss)
                        .semantics { contentDescription = "Close model and effort controls" },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier
                            .size(30.dp)
                            .clip(CircleShape)
                            .background(Color.White.copy(alpha = 0.07f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Close,
                            contentDescription = null,
                            tint = Frost.copy(alpha = 0.78f),
                            modifier = Modifier.size(17.dp),
                        )
                    }
                }
            }
            Text(
                "Drag to change effort level",
                color = Muted.copy(alpha = 0.86f),
                fontSize = 9.sp,
                lineHeight = 12.sp,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(6.dp))
            ReasoningTrack(
                value = selectedEffortIndex,
                valueCount = effortOptions.size,
                onValueChange = { value -> onEffort(effortOptions[value.coerceIn(0, effortOptions.lastIndex)]) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = horizontalPadding)
                    .semantics {
                        contentDescription = "Reasoning effort slider"
                        stateDescription = effortLabel
                    },
            )
            Row(
                Modifier.fillMaxWidth().padding(horizontal = horizontalPadding + 7.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    ReasoningEffortPolicy.label(effortOptions.first()),
                    color = Muted.copy(alpha = 0.7f),
                    fontSize = 8.sp,
                    lineHeight = 9.sp,
                )
                Text(
                    ReasoningEffortPolicy.label(effortOptions.last()),
                    color = Muted.copy(alpha = 0.7f),
                    fontSize = 8.sp,
                    lineHeight = 9.sp,
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(
                Modifier.fillMaxWidth().padding(horizontal = horizontalPadding + 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "MODEL",
                    color = Violet.copy(alpha = 0.94f),
                    fontSize = 8.sp,
                    lineHeight = 9.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.2.sp,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    "Next turn",
                    color = Muted.copy(alpha = 0.72f),
                    fontSize = 8.sp,
                    lineHeight = 9.sp,
                )
            }
            Spacer(Modifier.height(5.dp))
            BoxWithConstraints(Modifier.fillMaxWidth().height(54.dp)) {
                val choiceWidth = 128.dp
                val carouselPadding = ((maxWidth - choiceWidth) / 2).coerceAtLeast(0.dp)
                LazyRow(
                    modifier = Modifier.fillMaxWidth(),
                    state = modelListState,
                    contentPadding = PaddingValues(horizontal = carouselPadding),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(modelOptions.size, key = { index -> modelOptions[index]?.model ?: "auto" }) { index ->
                        val option = modelOptions[index]
                        val selected = option?.model == state.selectedModel || option == null && state.selectedModel == null
                        ModelChoice(
                            option = option,
                            selected = selected,
                            modifier = Modifier.width(choiceWidth).height(52.dp),
                            onClick = {
                                onModel(option?.model)
                                scope.launch { modelListState.animateScrollToItem(index) }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ReasoningTrack(
    value: Int,
    valueCount: Int,
    onValueChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val safeCount = valueCount.coerceAtLeast(1)
    val selectedValue = value.coerceIn(0, safeCount - 1)
    val latestValue by rememberUpdatedState(selectedValue)
    val latestOnValueChange by rememberUpdatedState(onValueChange)
    val haptics = LocalHapticFeedback.current
    var trackWidthPx by remember { mutableFloatStateOf(1f) }
    val latestTrackWidth by rememberUpdatedState(trackWidthPx)
    val valueRange = 0f..(safeCount - 1).toFloat()
    val targetRatio = if (safeCount == 1) 0.5f else selectedValue.toFloat() / (safeCount - 1).toFloat()
    val animatedRatio by animateFloatAsState(
        targetValue = targetRatio,
        animationSpec = tween(220, easing = AgenticEaseOut),
        label = "reasoning effort position",
    )

    Box(
        modifier
            .height(50.dp)
            .onSizeChanged { trackWidthPx = it.width.toFloat().coerceAtLeast(1f) }
            .semantics {
                progressBarRangeInfo = ProgressBarRangeInfo(selectedValue.toFloat(), valueRange)
                setProgress { requestedValue ->
                    val nextValue = requestedValue.roundToInt().coerceIn(0, safeCount - 1)
                    if (nextValue != selectedValue) {
                        haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                        onValueChange(nextValue)
                    }
                    true
                }
            }
            .pointerInput(safeCount) {
                fun updateFromPosition(positionX: Float) {
                    val edgeInset = 8.dp.toPx()
                    val usableWidth = (latestTrackWidth - edgeInset * 2f).coerceAtLeast(1f)
                    val ratio = ((positionX - edgeInset) / usableWidth).coerceIn(0f, 1f)
                    val nextValue = (ratio * (safeCount - 1)).roundToInt()
                    if (nextValue != latestValue) {
                        haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                        latestOnValueChange(nextValue)
                    }
                }
                detectHorizontalDragGestures(
                    onDragStart = { offset -> updateFromPosition(offset.x) },
                    onHorizontalDrag = { change, _ ->
                        change.consume()
                        updateFromPosition(change.position.x)
                    },
                )
            }
            .clip(RoundedCornerShape(25.dp))
            .background(Color(0xFF15161B).copy(alpha = 0.98f))
            .border(1.dp, Color.White.copy(alpha = 0.2f), RoundedCornerShape(25.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val inset = 8.dp.toPx()
            val railHeight = 30.dp.toPx()
            val railTop = (size.height - railHeight) / 2f
            val railWidth = (size.width - 2f * inset).coerceAtLeast(railHeight)
            val thumbTravel = (railWidth - railHeight).coerceAtLeast(0f)
            val centerY = size.height / 2f
            val thumbX = inset + railHeight / 2f + thumbTravel * animatedRatio
            val selectedWidth = thumbX - inset + railHeight / 2f
            val railRadius = CornerRadius(railHeight / 2f)

            drawRoundRect(
                color = Color(0xFF303038),
                topLeft = Offset(inset, railTop),
                size = Size(railWidth, railHeight),
                cornerRadius = railRadius,
            )
            drawRoundRect(
                color = Violet,
                topLeft = Offset(inset, railTop),
                size = Size(selectedWidth, railHeight),
                cornerRadius = railRadius,
            )

            val dotRadius = 4.dp.toPx()
            for (index in 0 until safeCount) {
                val dotRatio = if (safeCount == 1) 0.5f else index.toFloat() / (safeCount - 1).toFloat()
                drawCircle(
                    color = if (index <= selectedValue) {
                        Color.White.copy(alpha = 0.22f)
                    } else {
                        Color(0xFF74747B)
                    },
                    radius = dotRadius,
                    center = Offset(inset + railHeight / 2f + thumbTravel * dotRatio, centerY),
                )
            }

            drawCircle(
                color = Color.Black.copy(alpha = 0.42f),
                radius = 17.dp.toPx(),
                center = Offset(thumbX, centerY),
            )
            drawCircle(
                color = Color.White.copy(alpha = 0.2f),
                radius = 16.dp.toPx(),
                center = Offset(thumbX, centerY),
                style = Stroke(width = 1.dp.toPx()),
            )
            drawCircle(
                color = Frost,
                radius = 14.dp.toPx(),
                center = Offset(thumbX, centerY),
            )
        }
    }
}

@Composable
private fun ModelChoice(
    option: ModelOption?,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val title = option?.displayName ?: "Auto"
    val subtitle = option?.let { "Default · ${ReasoningEffortPolicy.label(it.defaultReasoningEffort)}" }
        ?: "Current Codex model"
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val haptics = LocalHapticFeedback.current
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.97f else 1f,
        animationSpec = tween(120, easing = AgenticEaseOut),
        label = "model choice press",
    )
    Box(
        modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(RoundedCornerShape(18.dp))
            .background(if (selected) Color(0xFF292236) else Color(0xFF17181D))
            .border(
                width = 1.dp,
                color = if (selected) Violet.copy(alpha = 0.86f) else Color.White.copy(alpha = 0.12f),
                shape = RoundedCornerShape(18.dp),
            )
            .semantics {
                this.selected = selected
                contentDescription = buildString {
                    append(title)
                    append(" model. ")
                    append(subtitle)
                    if (selected) append(". Selected")
                }
            }
            .clickable(
                interactionSource = interactions,
                indication = null,
                role = Role.Button,
            ) {
                haptics.performHapticFeedback(HapticFeedbackType.ToggleOn)
                onClick()
            },
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 11.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    title,
                    color = Frost,
                    fontSize = 10.sp,
                    lineHeight = 12.sp,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    subtitle,
                    color = Muted.copy(alpha = if (selected) 0.9f else 0.72f),
                    fontSize = 8.sp,
                    lineHeight = 10.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (selected) {
                Spacer(Modifier.width(6.dp))
                Box(
                    Modifier.size(18.dp).clip(CircleShape).background(Violet),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Check,
                        contentDescription = null,
                        tint = Ink,
                        modifier = Modifier.size(12.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatScreen(
    state: WearUiState,
    onBack: () -> Unit,
    onReply: () -> Unit,
    onRetry: () -> Unit,
    onRateMessage: (ChatMessage, FeedbackRating) -> Unit,
    onPermissionResponse: (ChatMessage, Boolean) -> Unit,
) {
    val listState = rememberLazyListState()
    val rotaryFocusRequester = remember { FocusRequester() }
    val horizontalPadding = roundAwareHorizontalPadding(round = 27.dp, square = 18.dp)
    val chat = state.chat
    val messages = chat?.messages.orEmpty()
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
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 5.dp)
                        .padding(bottom = 10.dp),
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
                item {
                    Box(Modifier.padding(bottom = 8.dp)) {
                        ErrorPill(message, Modifier.fillMaxWidth())
                    }
                }
            }
            if (messages.isEmpty()) {
                item {
                    EmptyState(
                        "No conversation yet",
                        "Tap Voice reply to start or continue this Codex session.",
                    )
                }
            } else {
                itemsIndexed(
                    items = messages,
                    key = { _, message -> message.id },
                ) { index, message ->
                    val nextMessage = messages.getOrNull(index + 1)
                    val sameCluster = nextMessage != null &&
                        nextMessage.turnId == message.turnId &&
                        nextMessage.role == message.role &&
                        nextMessage.kind == message.kind
                    ChatMessageItem(
                        message = message,
                        feedback = state.chatFeedback[message.id],
                        feedbackPending = state.feedbackPendingMessageId == message.id,
                        feedbackEnabled = state.feedbackPendingMessageId == null,
                        collapseUpdates = state.collapseUpdates,
                        approvalMode = state.approvalMode,
                        permissionPending = state.pending,
                        onRateMessage = onRateMessage,
                        onPermissionResponse = onPermissionResponse,
                        modifier = Modifier.padding(bottom = if (sameCluster) 5.dp else 12.dp),
                    )
                }
            }
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
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
private fun ChatMessageItem(
    message: ChatMessage,
    feedback: FeedbackRating?,
    feedbackPending: Boolean,
    feedbackEnabled: Boolean,
    collapseUpdates: Boolean,
    approvalMode: ApprovalMode,
    permissionPending: Boolean,
    onRateMessage: (ChatMessage, FeedbackRating) -> Unit,
    onPermissionResponse: (ChatMessage, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (message.kind == ChatMessageKind.PERMISSION) {
        PermissionChatMessage(
            message = message,
            approvalMode = approvalMode,
            pending = permissionPending,
            onPermissionResponse = onPermissionResponse,
            modifier = modifier,
        )
        return
    }
    when (message.role) {
        ChatRole.USER -> UserChatMessage(message = message, modifier = modifier)
        ChatRole.ASSISTANT -> AssistantChatMessage(
            message = message,
            feedback = feedback,
            feedbackPending = feedbackPending,
            feedbackEnabled = feedbackEnabled,
            collapseUpdates = collapseUpdates,
            onRateMessage = onRateMessage,
            modifier = modifier,
        )
    }
}

@Composable
private fun PermissionChatMessage(
    message: ChatMessage,
    approvalMode: ApprovalMode,
    pending: Boolean,
    onPermissionResponse: (ChatMessage, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val canRespond = message.canControl &&
        !message.resolved &&
        approvalMode == ApprovalMode.ALLOW_CONTROLS
    val stateLabel = when {
        message.resolved -> "Resolved"
        pending && canRespond -> "Working…"
        canRespond -> "Decision needed"
        else -> "Alert only"
    }
    val stateColor = when {
        message.resolved -> Mint
        canRespond -> Amber
        else -> Muted
    }
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Color(0xFF2C251C))
            .border(1.dp, Amber.copy(alpha = 0.66f), shape)
            .semantics {
                stateDescription = stateLabel
                contentDescription = permissionRequestContentDescription(stateLabel, message.text)
            }
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(Amber.copy(alpha = 0.14f))
                    .border(1.dp, Amber.copy(alpha = 0.46f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Rounded.Security,
                    contentDescription = null,
                    tint = Amber,
                    modifier = Modifier.size(18.dp),
                )
            }
            Spacer(Modifier.width(9.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    "PERMISSION",
                    color = Amber,
                    fontSize = 8.sp,
                    lineHeight = 9.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 0.8.sp,
                )
                Text(
                    stateLabel,
                    color = stateColor,
                    fontSize = 9.sp,
                    lineHeight = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            if (message.resolved) {
                Icon(
                    imageVector = Icons.Rounded.Check,
                    contentDescription = null,
                    tint = Mint,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
        Spacer(Modifier.height(7.dp))
        MarkdownMessageText(
            markdown = message.text,
            color = Frost,
            accent = Amber,
            codeBackground = Ink.copy(alpha = 0.78f),
            modifier = Modifier.fillMaxWidth(),
            fontSize = 11.sp,
            lineHeight = 14.sp,
        )
        if (canRespond) {
            Spacer(Modifier.height(7.dp))
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                PermissionDecisionButton(
                    label = "Decline",
                    approve = false,
                    enabled = !pending,
                    onClick = { onPermissionResponse(message, false) },
                    modifier = Modifier.weight(1f),
                )
                PermissionDecisionButton(
                    label = "Allow",
                    approve = true,
                    enabled = !pending,
                    onClick = { onPermissionResponse(message, true) },
                    modifier = Modifier.weight(1f),
                )
            }
        } else if (!message.resolved) {
            Spacer(Modifier.height(6.dp))
            Text(
                "Open Codex to decide",
                color = Muted.copy(alpha = 0.9f),
                fontSize = 9.sp,
                lineHeight = 11.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun PermissionDecisionButton(
    label: String,
    approve: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val haptics = LocalHapticFeedback.current
    val accent = if (approve) Amber else Coral
    val scale by animateFloatAsState(
        targetValue = if (pressed && enabled) 0.96f else 1f,
        animationSpec = tween(120, easing = AgenticEaseOut),
        label = "permission decision press",
    )
    Box(
        modifier
            .height(48.dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(CircleShape)
            .background(if (approve) accent else PanelRaised)
            .border(1.dp, accent.copy(alpha = 0.82f), CircleShape)
            .semantics { contentDescription = "$label this permission request" }
            .clickable(
                enabled = enabled,
                interactionSource = interactions,
                indication = null,
                role = Role.Button,
            ) {
                haptics.performHapticFeedback(HapticFeedbackType.ToggleOn)
                onClick()
            }
            .alpha(if (enabled) 1f else 0.52f),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (approve) Ink else Frost,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun UserChatMessage(
    message: ChatMessage,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(
        topStart = 20.dp,
        topEnd = 8.dp,
        bottomEnd = 20.dp,
        bottomStart = 20.dp,
    )
    Box(
        modifier = modifier.fillMaxWidth(),
        contentAlignment = Alignment.CenterEnd,
    ) {
        Column(
            Modifier
                .fillMaxWidth(0.86f)
                .clip(shape)
                .background(Color(0xFF292338))
                .border(1.dp, Violet.copy(alpha = 0.46f), shape)
                .padding(horizontal = 12.dp, vertical = 9.dp),
        ) {
            Text(
                "YOU",
                color = Violet.copy(alpha = 0.92f),
                fontSize = 8.sp,
                lineHeight = 9.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 0.8.sp,
                modifier = Modifier.align(Alignment.End),
            )
            Spacer(Modifier.height(3.dp))
            MarkdownMessageText(
                markdown = message.text,
                color = Frost,
                accent = Cyan,
                codeBackground = Ink.copy(alpha = 0.78f),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun AssistantChatMessage(
    message: ChatMessage,
    feedback: FeedbackRating?,
    feedbackPending: Boolean,
    feedbackEnabled: Boolean,
    collapseUpdates: Boolean,
    onRateMessage: (ChatMessage, FeedbackRating) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (message.phase == ChatPhase.COMMENTARY) {
        UpdateChatMessage(
            message = message,
            collapseUpdates = collapseUpdates,
            modifier = modifier,
        )
        return
    }
    AnswerChatMessage(
        message = message,
        feedback = feedback,
        feedbackPending = feedbackPending,
        feedbackEnabled = feedbackEnabled,
        onRateMessage = onRateMessage,
        modifier = modifier,
    )
}

@Composable
private fun UpdateChatMessage(
    message: ChatMessage,
    collapseUpdates: Boolean,
    modifier: Modifier = Modifier,
) {
    var collapsed by rememberSaveable(message.id, collapseUpdates) {
        mutableStateOf(ChatDisplayPolicy.startsCollapsed(message, collapseUpdates))
    }
    val interactions = remember { MutableInteractionSource() }
    val haptics = LocalHapticFeedback.current
    val chevronRotation by animateFloatAsState(
        targetValue = if (collapsed) 0f else 180f,
        animationSpec = tween(UpdateCollapseDurationMillis, easing = AgenticEaseOut),
        label = "update chevron",
    )
    val shape = RoundedCornerShape(
        topStart = 8.dp,
        topEnd = 20.dp,
        bottomEnd = 20.dp,
        bottomStart = 20.dp,
    )
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Panel)
            .border(1.dp, Color(0xFF34384D), shape)
            .semantics {
                stateDescription = if (collapsed) "Collapsed" else "Expanded"
            }
            .clickable(
                interactionSource = interactions,
                indication = null,
                role = Role.Button,
            ) {
                haptics.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
                collapsed = !collapsed
            }
            .padding(start = 13.dp, end = 9.dp, top = 9.dp, bottom = 9.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "UPDATE",
                color = Cyan.copy(alpha = 0.92f),
                fontSize = 8.sp,
                lineHeight = 9.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 0.8.sp,
            )
            Spacer(Modifier.weight(1f))
            Icon(
                imageVector = Icons.Rounded.KeyboardArrowDown,
                contentDescription = null,
                tint = Muted,
                modifier = Modifier
                    .size(18.dp)
                    .graphicsLayer { rotationZ = chevronRotation },
            )
        }
        Spacer(Modifier.height(3.dp))
        AnimatedContent(
            targetState = collapsed,
            modifier = Modifier.fillMaxWidth(),
            transitionSpec = {
                (fadeIn(tween(UpdateCollapseDurationMillis, easing = AgenticEaseOut)) togetherWith
                    fadeOut(tween(UpdateCollapseDurationMillis, easing = AgenticEaseOut))).using(
                    SizeTransform(clip = true) { _, _ ->
                        tween(UpdateCollapseDurationMillis, easing = AgenticEaseOut)
                    },
                )
            },
            contentAlignment = Alignment.TopStart,
            label = "update body",
        ) { showPreview ->
            MarkdownMessageText(
                markdown = message.text,
                color = Frost,
                accent = Cyan,
                codeBackground = Ink.copy(alpha = 0.78f),
                modifier = Modifier.fillMaxWidth().padding(end = 4.dp),
                maxLines = if (showPreview) 2 else Int.MAX_VALUE,
                overflow = if (showPreview) TextOverflow.Ellipsis else TextOverflow.Clip,
            )
        }
    }
}

@Composable
private fun AnswerChatMessage(
    message: ChatMessage,
    feedback: FeedbackRating?,
    feedbackPending: Boolean,
    feedbackEnabled: Boolean,
    onRateMessage: (ChatMessage, FeedbackRating) -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(
        topStart = 8.dp,
        topEnd = 20.dp,
        bottomEnd = 20.dp,
        bottomStart = 20.dp,
    )
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(PanelRaised)
            .border(1.dp, Violet.copy(alpha = 0.48f), shape)
            .padding(start = 13.dp, end = 9.dp, top = 9.dp, bottom = 4.dp),
    ) {
        Text(
            if (message.phase == ChatPhase.FINAL_ANSWER) "ANSWER" else "CODEX",
            color = Violet.copy(alpha = 0.92f),
            fontSize = 8.sp,
            lineHeight = 9.sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = 0.8.sp,
        )
        Spacer(Modifier.height(3.dp))
        MarkdownMessageText(
            markdown = message.text,
            color = Frost,
            accent = Violet,
            codeBackground = Ink.copy(alpha = 0.78f),
            modifier = Modifier.fillMaxWidth().padding(end = 4.dp),
        )
        Spacer(Modifier.height(2.dp))
        ChatFeedbackControls(
            selectedRating = feedback,
            pending = feedbackPending,
            enabled = feedbackEnabled,
            onRate = { rating -> onRateMessage(message, rating) },
        )
    }
}

@Composable
private fun ChatFeedbackControls(
    selectedRating: FeedbackRating?,
    pending: Boolean,
    enabled: Boolean,
    onRate: (FeedbackRating) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .semantics {
                if (pending) stateDescription = "Sending feedback"
            },
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (pending) {
            Text(
                "SENDING",
                color = Muted.copy(alpha = 0.78f),
                fontSize = 7.sp,
                lineHeight = 8.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.7.sp,
            )
            Spacer(Modifier.width(2.dp))
        }
        ChatFeedbackButton(
            rating = FeedbackRating.LIKED,
            selected = selectedRating == FeedbackRating.LIKED,
            pending = pending,
            enabled = enabled,
            onClick = { onRate(FeedbackRating.LIKED) },
        )
        ChatFeedbackButton(
            rating = FeedbackRating.DISLIKED,
            selected = selectedRating == FeedbackRating.DISLIKED,
            pending = pending,
            enabled = enabled,
            onClick = { onRate(FeedbackRating.DISLIKED) },
        )
    }
}

@Composable
private fun ChatFeedbackButton(
    rating: FeedbackRating,
    selected: Boolean,
    pending: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val haptics = LocalHapticFeedback.current
    val interactive = enabled && !pending
    val scale by animateFloatAsState(
        targetValue = if (pressed && interactive) 0.94f else 1f,
        animationSpec = tween(120, easing = AgenticEaseOut),
        label = "chat feedback press",
    )
    val liked = rating == FeedbackRating.LIKED
    val label = if (liked) "Like this Codex response" else "Dislike this Codex response"
    val accent = if (liked) Cyan else Coral
    Box(
        Modifier
            .size(48.dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .semantics {
                this.selected = selected
                contentDescription = label
                stateDescription = when {
                    pending -> "Feedback sending"
                    selected -> "Selected"
                    else -> "Not selected"
                }
            }
            .clickable(
                enabled = interactive,
                interactionSource = interactions,
                indication = null,
                role = Role.Button,
            ) {
                haptics.performHapticFeedback(HapticFeedbackType.ToggleOn)
                onClick()
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(if (selected) accent.copy(alpha = 0.16f) else Color.White.copy(alpha = 0.04f))
                .border(
                    1.dp,
                    if (selected) accent.copy(alpha = 0.78f) else Color.White.copy(alpha = 0.14f),
                    CircleShape,
                )
                .alpha(if (interactive || selected) 1f else 0.5f),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = if (liked) Icons.Rounded.ThumbUp else Icons.Rounded.ThumbDown,
                contentDescription = null,
                tint = if (selected) accent else Muted,
                modifier = Modifier.size(17.dp),
            )
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
        )
        Spacer(Modifier.height(5.dp))
        Text(
            alert?.detail ?: "Agent alerts will appear here.",
            color = Muted,
            fontSize = 11.sp,
            lineHeight = 14.sp,
            textAlign = TextAlign.Center,
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
    onCollapseUpdates: (Boolean) -> Unit,
    onUpdate: () -> Unit,
    onDisconnect: () -> Unit,
) {
    val listState = rememberLazyListState()
    val rotaryFocusRequester = remember { FocusRequester() }
    val horizontalPadding = roundAwareHorizontalPadding()
    val haptics = LocalHapticFeedback.current
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
            item { SectionLabel("CHAT") }
            item {
                SettingChoice(
                    title = "Collapse updates",
                    subtitle = "Updates start collapsed; answers stay open",
                    selected = state.collapseUpdates,
                ) {
                    haptics.performHapticFeedback(HapticFeedbackType.ToggleOn)
                    onCollapseUpdates(!state.collapseUpdates)
                }
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
    TactileCard(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .semantics {
                this.selected = selected
                stateDescription = if (selected) "Selected" else "Not selected"
            },
    ) {
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
    var detailsOpen by rememberSaveable(message) { mutableStateOf(false) }
    val presentation = errorDetailPresentation(message)
    Text(
        presentation.compactLabel,
        color = Frost,
        fontSize = 10.sp,
        lineHeight = 13.sp,
        textAlign = TextAlign.Center,
        modifier = modifier
            .clip(CircleShape)
            .background(Color(0xFF5A2431))
            .border(1.dp, Coral, CircleShape)
            .semantics { contentDescription = presentation.contentDescription }
            .clickable(role = Role.Button) { detailsOpen = true }
            .padding(horizontal = 13.dp, vertical = 7.dp),
    )
    if (detailsOpen) {
        FullTextDetailDialog(
            title = "Error details",
            message = presentation.fullText,
            onDismiss = { detailsOpen = false },
        )
    }
}

@Composable
private fun FullTextDetailDialog(title: String, message: String, onDismiss: () -> Unit) {
    val scrollState = rememberScrollState()
    val canScrollForward by remember { derivedStateOf { scrollState.canScrollForward } }
    val round = LocalConfiguration.current.isScreenRound
    var visible by remember { mutableStateOf(false) }
    var closing by remember { mutableStateOf(false) }
    val dismiss = {
        if (!closing) {
            closing = true
            visible = false
        }
    }

    LaunchedEffect(Unit) { visible = true }
    LaunchedEffect(closing) {
        if (closing) {
            delay(DetailOverlayMotionDurationMillis.toLong())
            onDismiss()
        }
    }

    Dialog(
        onDismissRequest = dismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        AnimatedVisibility(
            visible = visible,
            enter = fadeIn(tween(DetailOverlayMotionDurationMillis, easing = AgenticEaseOut)) +
                scaleIn(
                    animationSpec = tween(DetailOverlayMotionDurationMillis, easing = AgenticEaseOut),
                    initialScale = 0.97f,
                ) +
                slideInVertically(
                    animationSpec = tween(DetailOverlayMotionDurationMillis, easing = AgenticEaseOut),
                    initialOffsetY = { it / 16 },
                ),
            exit = fadeOut(tween(DetailOverlayMotionDurationMillis, easing = AgenticEaseInOut)) +
                scaleOut(
                    animationSpec = tween(DetailOverlayMotionDurationMillis, easing = AgenticEaseInOut),
                    targetScale = 0.97f,
                ) +
                slideOutVertically(
                    animationSpec = tween(DetailOverlayMotionDurationMillis, easing = AgenticEaseInOut),
                    targetOffsetY = { it / 16 },
                ),
        ) {
            // An opaque full-screen layer prevents the underlying assistant orb or
            // recovery actions from visually or semantically competing with Close.
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Ink)
                    .semantics { contentDescription = "$title. Full-screen dialog." },
            ) {
                Column(
                    Modifier
                        .fillMaxSize()
                        .padding(
                            start = if (round) 52.dp else 28.dp,
                            end = if (round) 52.dp else 28.dp,
                            top = if (round) 40.dp else 20.dp,
                            bottom = if (round) 44.dp else 20.dp,
                        ),
                ) {
                    Text(
                        title,
                        color = Coral,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        message,
                        color = Frost,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                        modifier = Modifier.weight(1f).verticalScroll(scrollState),
                    )
                    detailScrollAffordance(canScrollForward)?.let { affordance ->
                        Spacer(Modifier.height(8.dp))
                        Text(
                            affordance,
                            color = Mint,
                            fontSize = 10.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier
                                .fillMaxWidth()
                                .semantics {
                                    contentDescription = "Swipe to read more. Full error text is scrollable."
                                },
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        ActionButton("Close", true, dismiss, enabled = true)
                    }
                }
            }
        }
    }
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
