package io.github.sirbughunter.agenticwear.ui

import android.content.Context
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.FormatListBulleted
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.Keyboard
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.NotificationsNone
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.SwipeToDismissBox
import androidx.wear.compose.material3.Text
import io.github.sirbughunter.agenticwear.data.AppPreferences
import io.github.sirbughunter.agenticwear.live.LiveVoiceActivity
import io.github.sirbughunter.agenticwear.live.LiveVoiceColour
import io.github.sirbughunter.agenticwear.live.LiveVoiceService
import io.github.sirbughunter.agenticwear.live.LiveVoiceState
import io.github.sirbughunter.agenticwear.voice.VoiceLoopPhase
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import io.github.sirbughunter.agenticwear.voice.voiceLoopLabel
import io.github.sirbughunter.agenticwear.model.SessionStatus
import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import io.github.sirbughunter.agenticwear.update.UpdateStage
import io.github.sirbughunter.agenticwear.update.UpdateUiState
import kotlinx.coroutines.delay

internal val AwEase = CubicBezierEasing(0.22f, 0.9f, 0.25f, 1f)

/** Navigation depth: deeper screens slide in from the right, shallower ones from the left. */
private fun WearScreen.depth(): Int = when (this) {
    WearScreen.HOME, WearScreen.PAIR -> 0
    WearScreen.SESSIONS, WearScreen.ACTIVITY, WearScreen.SETTINGS -> 1
    WearScreen.CHAT, WearScreen.ALERT -> 2
    WearScreen.REPLY, WearScreen.TRANSCRIPT -> 3
}

/** Opens the live call screen; [autoConnect] starts the call immediately. */
internal fun Context.openLiveCall(autoConnect: Boolean) {
    startActivity(Intent(this, LiveVoiceActivity::class.java).putExtra(LiveVoiceActivity.EXTRA_AUTO_CONNECT, autoConnect))
    // Cross-fade instead of sliding, so a selected Dot appears to stay in place. API 34+ sets this in the activity itself.
    @Suppress("DEPRECATION")
    if (android.os.Build.VERSION.SDK_INT < 34) (this as? android.app.Activity)?.overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
}

internal fun LiveVoiceState.callActive(): Boolean = phase in setOf("creating", "connecting", "live", "reconnecting")

internal fun LiveVoiceState.orbMode(): OrbMode = when {
    phase in setOf("creating", "connecting") -> OrbMode.Connecting
    phase == "reconnecting" -> OrbMode.Reconnecting
    phase != "live" -> OrbMode.Idle
    approvalId != null -> OrbMode.Approval
    outputLevel > 0.01f || mediaActivity == "speaking" -> OrbMode.Speaking
    muted -> OrbMode.Muted
    inputLevel > 0.01f || mediaActivity == "listening" -> OrbMode.Listening
    taskPhase in setOf("handoff", "working") || mediaActivity == "thinking" -> OrbMode.Thinking
    else -> OrbMode.Listening
}

@Composable
fun AgenticWearApp(
    viewModel: AgenticWearViewModel,
    onPushToTalk: () -> Unit,
    pairingCodePrefill: String = "",
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val live by LiveVoiceService.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val preferences = remember { AppPreferences(context) }
    // Dot uses native Watch media through the browser-owned authenticated call.
    // Other cloud chats retain the existing turn-based conversation entry.
    val startVoice: () -> Unit = {
        val src = state.selectedSession?.source
        if (src == "cloud") {
            if (androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED) viewModel.startVoiceLoop() else onPushToTalk()
        } else context.openLiveCall(autoConnect = !live.callActive())
    }
    // A selected Dot tints every orb in its own colour.
    val selectedIsDot = state.selectedSession?.source == "dot" || state.selectedThreadId?.startsWith("dot:") == true
    val orbPalette = remember(state.screen, selectedIsDot) {
        if (selectedIsDot) DotAvatar.fromLabel(preferences.dotAvatar).orbPalette()
        else LiveVoiceColour.fromLabel(preferences.liveVoiceColour).orbPalette()
    }

    // A small UI back stack so Back returns to the list a chat or alert came from.
    val trail = rememberSaveable { mutableStateListOf<String>() }
    LaunchedEffect(state.screen) {
        val name = state.screen.name
        val existing = trail.indexOf(name)
        if (existing >= 0) {
            while (trail.size > existing + 1) trail.removeAt(trail.lastIndex)
        } else {
            if (state.screen.depth() == 0) trail.clear()
            trail.add(name)
        }
    }
    val previous = trail.getOrNull(trail.lastIndex - 1)?.let { runCatching { WearScreen.valueOf(it) }.getOrNull() }
    val back: (() -> Unit)? = when (state.screen) {
        WearScreen.HOME, WearScreen.PAIR -> null
        WearScreen.TRANSCRIPT -> viewModel::discardTranscript
        WearScreen.REPLY -> viewModel::cancelReplyFromChat
        WearScreen.CHAT -> { { viewModel.navigate(if (previous == WearScreen.SESSIONS) WearScreen.SESSIONS else WearScreen.HOME) } }
        WearScreen.ALERT -> { { viewModel.navigate(if (previous == WearScreen.ACTIVITY) WearScreen.ACTIVITY else WearScreen.HOME) } }
        WearScreen.SETTINGS -> { { viewModel.navigate(if (previous == WearScreen.SESSIONS) WearScreen.SESSIONS else WearScreen.HOME) } }
        else -> { { viewModel.navigate(WearScreen.HOME) } }
    }
    val voiceActive = state.recording || state.transcribing
    BackHandler(enabled = back != null && !voiceActive) { back?.invoke() }

    var dismissedBySwipe by remember { mutableStateOf(false) }
    LaunchedEffect(state.screen) { delay(400); dismissedBySwipe = false }

    Box(Modifier.fillMaxSize().background(Aw.Bg)) {
        val screenContent: @Composable (WearScreen) -> Unit = { screen ->
            when (screen) {
                WearScreen.HOME -> HomeScreen(
                    state = state,
                    live = live,
                    palette = orbPalette,
                    onTalk = startVoice,
                    onDictate = onPushToTalk,
                    onOpenTarget = { if (state.selectedSession == null) viewModel.navigate(WearScreen.SESSIONS) else viewModel.openSelectedChat() },
                    onChats = { viewModel.navigate(WearScreen.SESSIONS) },
                    onActivity = { viewModel.navigate(WearScreen.ACTIVITY) },
                    onUpdate = viewModel::onUpdateAction,
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
                    onSelect = viewModel::openSession,
                    onSettings = { viewModel.navigate(WearScreen.SETTINGS) },
                    onActivity = { viewModel.navigate(WearScreen.ACTIVITY) },
                    palette = orbPalette,
                )
                WearScreen.ACTIVITY -> ActivityScreen(
                    onOpen = { alert -> viewModel.openAlert(alert.eventId, readOnly = true) },
                )
                WearScreen.TRANSCRIPT -> TranscriptScreen(
                    state = state,
                    onBack = viewModel::discardTranscript,
                    onTextChanged = viewModel::updateTranscript,
                    onSend = viewModel::submitTranscript,
                    onRevise = { if (viewModel.reviseTranscript()) onPushToTalk() },
                    onOriginal = viewModel::restoreOriginal,
                    onUndo = viewModel::undoTranscript,
                    onRetry = viewModel::retryTranscript,
                    onModel = viewModel::setModel,
                    onEffort = viewModel::setReasoningEffort,
                    onCloudModel = viewModel::setCloudModel,
                    onCloudEffort = viewModel::setCloudEffort,
                    onApprovalMode = viewModel::setApprovalMode,
                    onRefreshSessions = viewModel::refreshSessionsForRecovery,
                    onStartNewSession = viewModel::startNewSessionForRecovery,
                )
                WearScreen.REPLY -> ReplyChoiceScreen(
                    title = state.chat?.title ?: state.selectedSession?.title.orEmpty(),
                    onTalk = {
                        viewModel.cancelReplyFromChat()
                        startVoice()
                    },
                    onDictate = {
                        viewModel.replyWithVoiceFromChat()
                        onPushToTalk()
                    },
                    onType = viewModel::replyWithTextFromChat,
                )
                WearScreen.CHAT -> ChatScreen(
                    state = state,
                    onReply = viewModel::replyFromChat,
                    onRetry = viewModel::retryChat,
                    onDismissSubmission = viewModel::dismissSubmission,
                    onReadAloud = viewModel::readAloud,
                    onRateMessage = viewModel::rateChatMessage,
                    onPermissionResponse = viewModel::respondToChatPermission,
                    palette = orbPalette,
                    onAnswerQuestion = viewModel::answerQuestion,
                    onReplyToQuestion = viewModel::replyToQuestionFromChat,
                )
                WearScreen.ALERT -> AlertScreen(
                    alert = state.latestAlert,
                    readOnly = state.alertReadOnly,
                    approvalMode = state.approvalMode,
                    pending = state.pending,
                    onBack = { viewModel.navigate(WearScreen.HOME) },
                    onApprove = { viewModel.respondToApproval(true, state.latestAlert?.approvalId) },
                    onDecline = { viewModel.respondToApproval(false, state.latestAlert?.approvalId) },
                    onOpenChat = viewModel::openSession,
                )
                WearScreen.SETTINGS -> SettingsScreen(
                    state = state,
                    onEngine = viewModel::setTranscriptionEngine,
                    onApprovalMode = viewModel::setApprovalMode,
                    onCollapseUpdates = viewModel::setCollapseUpdates,
                    onPopSound = viewModel::setPopSoundEnabled,
                    onUpdate = viewModel::onUpdateAction,
                    onDisconnect = viewModel::disconnect,
                    onLiveCall = { context.openLiveCall(autoConnect = false) },
                )
            }
        }

        val animated: @Composable () -> Unit = {
            AnimatedContent(
                targetState = state.screen,
                transitionSpec = {
                    if (dismissedBySwipe) {
                        EnterTransition.None togetherWith ExitTransition.None
                    } else {
                        // Shared Z-axis: the new screen grows in from behind while the old one recedes.
                        val forward = targetState.depth() >= initialState.depth()
                        val distance = if (forward) 1 else -1
                        val enterSpec = tween<Float>(Aw.MotionDuration, easing = AwEase)
                        (fadeIn(enterSpec) +
                            scaleIn(enterSpec, initialScale = if (forward) .92f else 1.06f, transformOrigin = TransformOrigin.Center) +
                            slideInHorizontally(tween(Aw.MotionDuration, easing = AwEase)) { it / 12 * distance }) togetherWith
                            (fadeOut(tween(220, easing = AwEase)) +
                                scaleOut(tween(Aw.MotionDuration, easing = AwEase), targetScale = if (forward) 1.06f else .92f, transformOrigin = TransformOrigin.Center))
                    }
                },
                label = "screen",
            ) { screen -> screenContent(screen) }
        }

        if (back != null && !voiceActive) {
            SwipeToDismissBox(
                onDismissed = { dismissedBySwipe = true; back() },
                backgroundKey = previous?.name ?: "home",
                contentKey = state.screen.name,
                userSwipeEnabled = state.screen != WearScreen.TRANSCRIPT,
            ) { isBackground ->
                if (isBackground) {
                    Box(Modifier.fillMaxSize().background(Aw.Bg)) { screenContent(previous ?: WearScreen.HOME) }
                } else {
                    animated()
                }
            }
        } else {
            animated()
        }

        state.error?.takeIf {
            state.screen !in setOf(WearScreen.PAIR, WearScreen.CHAT, WearScreen.TRANSCRIPT, WearScreen.HOME) && !voiceActive
        }?.let { error ->
            ErrorToast(error, initiallyOpen = state.showErrorDetails,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = if (state.screen == WearScreen.ALERT) 64.dp else 18.dp))
        }

        AnimatedVisibility(
            visible = voiceActive && state.voiceLoop == VoiceLoopPhase.IDLE,
            enter = fadeIn(tween(220)) + scaleIn(tween(320, easing = AwEase), initialScale = 1.04f),
            exit = fadeOut(tween(180)) + scaleOut(tween(180), targetScale = 1.02f),
        ) {
            val revising = remember(state.recording) { preferences.revisionBase != null }
            DictationScreen(
                recording = state.recording,
                transcribing = state.transcribing,
                level = state.voiceLevel,
                transcriptionElapsedMillis = state.transcriptionElapsedMillis,
                lead = when {
                    revising -> "Edit draft by voice"
                    state.selectedSession == null || state.submitDraftAsNewSession -> "Dictate a new chat"
                    else -> "Dictate to"
                },
                target = if (revising || state.submitDraftAsNewSession) "" else state.selectedSession?.title.orEmpty(),
                engine = state.transcriptionEngine,
                onFinish = onPushToTalk,
                onCancel = viewModel::cancelVoiceRequest,
            )
        }

        AnimatedVisibility(
            visible = state.voiceLoop != VoiceLoopPhase.IDLE,
            enter = fadeIn(tween(220)),
            exit = fadeOut(tween(180)),
        ) {
            VoiceLoopScreen(
                phase = state.voiceLoop,
                title = state.selectedSession?.title.orEmpty(),
                level = state.voiceLevel,
                palette = orbPalette,
                onFinishListening = viewModel::endPushToTalk,
                onStop = viewModel::stopVoiceLoop,
            )
        }

        AnimatedVisibility(
            visible = state.showInstallPermissionPrompt,
            enter = fadeIn(tween(200)) + scaleIn(tween(260, easing = AwEase), initialScale = 1.04f),
            exit = fadeOut(tween(160)),
        ) {
            InstallPermissionPrompt(
                onContinue = viewModel::continueInstallAfterWarning,
                onDismiss = viewModel::dismissInstallPermissionPrompt,
            )
        }

        if (state.screen != WearScreen.PAIR) LiveCallPill(live = live, onClick = { context.openLiveCall(autoConnect = false) })
    }
}

/** Turn-based voice conversation (Dot and cloud chats): orb, state label and a clear Stop. */
@Composable
private fun VoiceLoopScreen(
    phase: VoiceLoopPhase,
    title: String,
    level: Float,
    palette: OrbPalette,
    onFinishListening: () -> Unit,
    onStop: () -> Unit,
) {
    BackHandler(onBack = onStop)
    val view = androidx.compose.ui.platform.LocalView.current
    DisposableEffect(view) {
        val previous = view.keepScreenOn
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = previous }
    }
    Box(Modifier.fillMaxSize().background(Aw.Bg)) {
        Column(
            Modifier.fillMaxSize().padding(top = 26.dp, bottom = 60.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(title, style = AwType.Caption, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 24.dp))
            Spacer(Modifier.height(8.dp))
            Box(
                Modifier.size(104.dp).clip(CircleShape)
                    .clickable(enabled = phase == VoiceLoopPhase.LISTENING, role = Role.Button, onClick = onFinishListening)
                    .semantics { contentDescription = if (phase == VoiceLoopPhase.LISTENING) "Finish speaking" else voiceLoopLabel(phase) },
            ) {
                CloudOrb(
                    palette = palette,
                    mode = when (phase) {
                        VoiceLoopPhase.LISTENING -> OrbMode.Listening
                        VoiceLoopPhase.SPEAKING -> OrbMode.Speaking
                        VoiceLoopPhase.IDLE -> OrbMode.Idle
                        else -> OrbMode.Thinking
                    },
                    userLevel = if (phase == VoiceLoopPhase.LISTENING) level else 0f,
                    agentLevel = 0f,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                voiceLoopLabel(phase),
                style = AwType.Label,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            if (phase == VoiceLoopPhase.LISTENING) Text("Tap the orb when done", style = AwType.Micro)
        }
        AwEdgeButton("Stop", onClick = onStop, primary = false)
    }
}

/** While a live call runs, a pill replaces the time so returning to it is one tap away. */
@Composable
private fun BoxScope.LiveCallPill(live: LiveVoiceState, onClick: () -> Unit) {
    val active = live.callActive()
    if (!active) {
        AwTimeText()
        return
    }
    val reconnecting = live.phase == "reconnecting"
    val tint = if (reconnecting) Aw.Attention else Aw.ReadyText
    Row(
        Modifier
            .align(Alignment.TopCenter)
            .padding(top = 6.dp)
            .heightIn(min = 22.dp)
            .clip(Aw.PillShape)
            .background(tint.copy(alpha = .16f))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 10.dp)
            .semantics { contentDescription = "Return to live call" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        StatusIndicator(if (reconnecting) StatusKind.Attention else StatusKind.Live)
        Text(if (reconnecting) "Reconnecting" else "Live call", color = tint, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
    }
}

internal fun SessionStatus.kind(): StatusKind = when (this) {
    SessionStatus.ACTIVE -> StatusKind.Working
    SessionStatus.IDLE -> StatusKind.Ready
    SessionStatus.NOT_LOADED -> StatusKind.Idle
    SessionStatus.ERROR -> StatusKind.Error
}

internal val SessionStatus.label: String
    get() = when (this) {
        SessionStatus.ACTIVE -> "Working"
        SessionStatus.IDLE -> "Ready"
        SessionStatus.NOT_LOADED -> "Available"
        SessionStatus.ERROR -> "Needs attention"
    }

internal val SessionStatus.textColor
    get() = when (this) {
        SessionStatus.ACTIVE -> Aw.Working
        SessionStatus.ERROR -> Aw.ErrorText
        else -> Aw.TextSecondary
    }

// ─────────────────────────────── Home ───────────────────────────────

@Composable
private fun HomeScreen(
    state: WearUiState,
    live: LiveVoiceState,
    palette: OrbPalette,
    onTalk: () -> Unit,
    onDictate: () -> Unit,
    onOpenTarget: () -> Unit,
    onChats: () -> Unit,
    onActivity: () -> Unit,
    onUpdate: () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val callActive = live.callActive()
    val session = state.selectedSession
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = maxWidth
        val h = maxHeight
        val orbSize = w * 0.4f
        val orbCenterY = h * 0.425f
        // Target chat chip.
        val chipInteractions = remember { MutableInteractionSource() }
        Row(
            Modifier
                .align(Alignment.TopCenter)
                .padding(top = h * 0.105f)
                .widthIn(max = w * 0.68f)
                .heightIn(min = 30.dp)
                .pressScale(chipInteractions)
                .clip(Aw.PillShape)
                .background(Aw.Surface)
                .border(1.dp, Aw.Line, Aw.PillShape)
                .clickable(interactionSource = chipInteractions, indication = null, role = Role.Button, onClick = onOpenTarget)
                .padding(start = 10.dp, end = 7.dp)
                .semantics(mergeDescendants = true) {
                    contentDescription = session?.let { "Open ${it.title}, ${it.status.label}" } ?: "Choose a chat"
                },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (session != null) StatusIndicator(session.status.kind())
            Text(
                session?.title ?: "Choose a chat",
                style = AwType.Label.copy(color = Aw.Text),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = Aw.TextTertiary, modifier = Modifier.size(14.dp))
        }

        // The orb: tap to talk live. During a call it mirrors the call.
        val orbInteractions = remember { MutableInteractionSource() }
        Box(
            Modifier
                .offset(x = (w - orbSize) / 2, y = orbCenterY - orbSize / 2)
                .size(orbSize)
                .pressScale(orbInteractions, 0.95f)
                .clickable(
                    interactionSource = orbInteractions,
                    indication = null,
                    enabled = state.isPaired,
                    role = Role.Button,
                ) {
                    haptics.performHapticFeedback(HapticFeedbackType.ToggleOn)
                    onTalk()
                }
                .semantics { contentDescription = if (callActive) "Return to live call" else "Talk live with ${session?.title ?: "Codex"}" },
        ) {
            val context = LocalContext.current
            val prefs = remember { AppPreferences(context) }
            val homeMode = if (callActive) live.orbMode() else if (session?.status == SessionStatus.ACTIVE) OrbMode.Thinking else OrbMode.Idle
            val isDot = session?.source == "dot" || session?.id?.startsWith("dot:") == true
            // The selected Dot sits on the first page itself; the orb is for other chats (or by choice).
            if (isDot && prefs.dotCallVisual != "Orb") {
                DotFigure(
                    DotAvatar.fromLabel(prefs.dotAvatar),
                    homeMode.toDotMood(),
                    Modifier.fillMaxSize(.86f).align(Alignment.Center),
                    userLevel = if (callActive && !live.muted) live.inputLevel else 0f,
                    agentLevel = if (callActive) live.outputLevel else 0f,
                )
            } else CloudOrb(
                palette = palette,
                mode = homeMode,
                userLevel = if (callActive && !live.muted) live.inputLevel else 0f,
                agentLevel = if (callActive) live.outputLevel else 0f,
                modifier = Modifier.fillMaxSize(),
            )
        }

        // Side actions.
        val sideSize = 40.dp
        AwCircleButton(
            Icons.AutoMirrored.Rounded.FormatListBulleted, "Chats", onChats,
            modifier = Modifier.offset(x = w * 0.135f - 24.dp, y = orbCenterY - 24.dp),
            size = sideSize,
        )
        AwCircleButton(
            Icons.Rounded.NotificationsNone, if (state.latestAlert != null) "Activity, new event" else "Activity", onActivity,
            modifier = Modifier.offset(x = w * 0.865f - 24.dp, y = orbCenterY - 24.dp),
            size = sideSize,
            badge = when (state.latestAlert?.kind) {
                null -> null
                io.github.sirbughunter.agenticwear.model.AlertKind.COMPLETE -> Aw.Ready
                io.github.sirbughunter.agenticwear.model.AlertKind.PERMISSION -> Aw.Attention
                io.github.sirbughunter.agenticwear.model.AlertKind.ERROR -> Aw.Error
                io.github.sirbughunter.agenticwear.model.AlertKind.QUESTION -> Aw.Attention
            },
        )

        // Label or update status under the orb.
        val updateOnHome = !state.pending && state.appUpdate.stage in setOf(UpdateStage.AVAILABLE, UpdateStage.DOWNLOADING, UpdateStage.READY)
        Box(
            Modifier
                .align(Alignment.TopCenter)
                .padding(top = orbCenterY + orbSize / 2 + 7.dp),
        ) {
            when {
                state.error != null && !state.pending -> HomeErrorPill(state.error, state.showErrorDetails)
                updateOnHome -> HomeUpdatePill(state.appUpdate, onUpdate)
                state.pending -> ShimmerText("Sending…", fontSize = 12.sp)
                callActive -> Text("Tap the orb to return", style = AwType.Label)
                else -> Text("Tap to talk live", style = AwType.Label)
            }
        }

        AwEdgeButton(
            label = "Dictate",
            icon = Icons.Rounded.Mic,
            primary = false,
            enabled = state.isPaired && !state.pending,
            onClick = {
                haptics.performHapticFeedback(HapticFeedbackType.ToggleOn)
                onDictate()
            },
        )
    }
}

@Composable
private fun HomeErrorPill(message: String, initiallyOpen: Boolean) {
    var open by rememberSaveable(message, initiallyOpen) { mutableStateOf(initiallyOpen) }
    val presentation = errorDetailPresentation(message)
    Row(
        Modifier
            .heightIn(min = 26.dp)
            .widthIn(max = 150.dp)
            .clip(Aw.PillShape)
            .background(Aw.ErrorSurface)
            .clickable(role = Role.Button) { open = true }
            .padding(horizontal = 10.dp)
            .semantics { contentDescription = presentation.contentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon(Icons.Rounded.ErrorOutline, null, tint = Aw.ErrorText, modifier = Modifier.size(13.dp))
        Text(presentation.fullText, color = Aw.ErrorSoft, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    if (open) ErrorDetailDialog(title = "Error details", message = presentation.fullText, onDismiss = { open = false })
}

@Composable
private fun HomeUpdatePill(update: UpdateUiState, onClick: () -> Unit) {
    val label = when (update.stage) {
        UpdateStage.AVAILABLE -> "Update available"
        UpdateStage.DOWNLOADING -> if (update.progress > 0) "Downloading ${update.progress}%" else "Downloading…"
        UpdateStage.READY -> "Install update"
        else -> "Update"
    }
    val actionable = update.stage == UpdateStage.AVAILABLE || update.stage == UpdateStage.READY
    Row(
        Modifier
            .heightIn(min = 26.dp)
            .clip(Aw.PillShape)
            .background(Aw.Ready.copy(alpha = .14f))
            .clickable(enabled = actionable, role = Role.Button, onClick = onClick)
            .padding(horizontal = 11.dp)
            .semantics { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon(if (update.stage == UpdateStage.READY) Icons.Rounded.Check else Icons.Rounded.Download, null, tint = Aw.ReadyText, modifier = Modifier.size(13.dp))
        Text(label, color = Aw.ReadyText, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

// ─────────────────────────────── Dictation ───────────────────────────────

@Composable
private fun DictationScreen(
    recording: Boolean,
    transcribing: Boolean,
    level: Float,
    transcriptionElapsedMillis: Long?,
    lead: String,
    target: String,
    engine: TranscriptionEngine,
    onFinish: () -> Unit,
    onCancel: () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    var seconds by remember { mutableIntStateOf(0) }
    LaunchedEffect(recording) {
        if (!recording) return@LaunchedEffect
        seconds = 0
        while (true) { delay(1000); seconds += 1 }
    }
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .background(Aw.Bg)
            .pointerInput(onCancel) {
                // Tapping anywhere outside the controls cancels, as before.
                detectTapGestures { haptics.performHapticFeedback(HapticFeedbackType.Reject); onCancel() }
            },
    ) {
        val w = maxWidth
        val h = maxHeight
        Column(
            Modifier.align(Alignment.TopCenter).padding(top = h * 0.115f).padding(horizontal = w * 0.16f),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(lead, style = AwType.Micro, textAlign = TextAlign.Center)
            if (target.isNotBlank()) {
                Text(target, style = AwType.Label.copy(color = Aw.Text, fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        val finishInteractions = remember { MutableInteractionSource() }
        DictationWaveform(
            level = level,
            transcribing = transcribing,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(top = h * 0.33f)
                .size(w * 0.51f, h * 0.25f)
                .clickable(interactionSource = finishInteractions, indication = null, enabled = recording, role = Role.Button) {
                    haptics.performHapticFeedback(HapticFeedbackType.GestureEnd)
                    onFinish()
                }
                .semantics { contentDescription = if (recording) "Finish and transcribe" else "Transcribing" },
        )
        Box(Modifier.align(Alignment.TopCenter).padding(top = h * 0.61f)) {
            if (transcribing) {
                val elapsed = transcriptionElapsedMillis?.let { " · ${formatTranscriptionElapsed(it)}" }.orEmpty()
                ShimmerText("Transcribing$elapsed", fontSize = 12.sp)
            } else {
                val engineName = when (engine) {
                    TranscriptionEngine.BRIDGE_PHONON -> "Phonon"
                    TranscriptionEngine.BRIDGE_WHISPER -> "Whisper"
                    TranscriptionEngine.DEVICE_SPEECH -> "Watch"
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("%d:%02d".format(seconds / 60, seconds % 60), color = Aw.Text, fontSize = 14.sp, fontWeight = FontWeight.Medium,
                        style = androidx.compose.ui.text.TextStyle(fontFeatureSettings = "tnum"))
                    Text("  ·  $engineName", style = AwType.Caption)
                }
            }
        }
        Row(
            Modifier.align(Alignment.BottomCenter).padding(bottom = h * 0.06f),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            AwCircleButton(Icons.Rounded.Close, "Cancel dictation", onClick = {
                haptics.performHapticFeedback(HapticFeedbackType.Reject); onCancel()
            }, size = 42.dp, container = Aw.SurfaceHigh, bordered = false)
            if (recording) {
                AwCircleButton(Icons.Rounded.Check, "Finish and transcribe", onClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.GestureEnd); onFinish()
                }, size = 42.dp, container = Aw.Text, content = Aw.OnPrimary, bordered = false)
            }
        }
    }
}

// ─────────────────────────────── Reply ───────────────────────────────

@Composable
private fun ReplyChoiceScreen(
    title: String,
    onTalk: () -> Unit,
    onDictate: () -> Unit,
    onType: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(Aw.Bg)) {
        Column(
            Modifier.fillMaxSize().padding(horizontal = roundHorizontalPadding()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Reply", style = AwType.Title)
            if (title.isNotBlank()) {
                Text(title, style = AwType.Caption, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 14.dp))
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                ReplyChoice("Talk", Icons.Rounded.GraphicEq, primary = true, onClick = onTalk)
                ReplyChoice("Dictate", Icons.Rounded.Mic, primary = false, onClick = onDictate)
                ReplyChoice("Type", Icons.Rounded.Keyboard, primary = false, onClick = onType)
            }
        }
    }
}

@Composable
private fun ReplyChoice(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, primary: Boolean, onClick: () -> Unit) {
    val interactions = remember { MutableInteractionSource() }
    Column(
        Modifier
            .clip(Aw.CardShape)
            .clickable(interactionSource = interactions, indication = null, role = Role.Button, onClick = onClick)
            .padding(4.dp)
            .semantics(mergeDescendants = true) { contentDescription = "$label reply" },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(48.dp)
                .pressScale(interactions, 0.92f)
                .clip(CircleShape)
                .background(if (primary) Aw.Text else Aw.SurfaceRaised),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = if (primary) Aw.OnPrimary else Aw.Text, modifier = Modifier.size(21.dp))
        }
        Spacer(Modifier.height(5.dp))
        Text(label, style = AwType.Label.copy(color = Aw.Text))
    }
}

// ─────────────────────────────── Errors ───────────────────────────────

@Composable
private fun ErrorToast(message: String, initiallyOpen: Boolean, modifier: Modifier = Modifier) {
    var open by rememberSaveable(message, initiallyOpen) { mutableStateOf(initiallyOpen) }
    val presentation = errorDetailPresentation(message)
    Row(
        modifier
            .padding(horizontal = 36.dp)
            .clip(Aw.PillShape)
            .background(Aw.ErrorSurface)
            .border(1.dp, Aw.Error.copy(alpha = .35f), Aw.PillShape)
            .clickable(role = Role.Button) { open = true }
            .padding(horizontal = 10.dp, vertical = 6.dp)
            .semantics { contentDescription = presentation.contentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon(Icons.Rounded.ErrorOutline, null, tint = Aw.ErrorText, modifier = Modifier.size(13.dp))
        Text(presentation.fullText, color = Aw.ErrorSoft, fontSize = 11.sp, lineHeight = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
    if (open) ErrorDetailDialog(title = "Error details", message = presentation.fullText, onDismiss = { open = false })
}
