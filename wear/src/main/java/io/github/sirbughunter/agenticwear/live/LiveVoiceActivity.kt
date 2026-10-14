package io.github.sirbughunter.agenticwear.live

import android.Manifest
import android.app.Activity
import android.os.Build
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CallEnd
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MicOff
import androidx.compose.material.icons.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Security
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.Text
import io.github.sirbughunter.agenticwear.BuildConfig
import io.github.sirbughunter.agenticwear.MainActivity
import io.github.sirbughunter.agenticwear.data.AgenticWearRepository
import io.github.sirbughunter.agenticwear.data.AppPreferences
import io.github.sirbughunter.agenticwear.model.ApprovalMode
import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import io.github.sirbughunter.agenticwear.ui.Aw
import io.github.sirbughunter.agenticwear.ui.AwCircleButton
import io.github.sirbughunter.agenticwear.ui.AwDialog
import io.github.sirbughunter.agenticwear.ui.AwEdgeButton
import io.github.sirbughunter.agenticwear.ui.AwPillButton
import io.github.sirbughunter.agenticwear.ui.AwRowCard
import io.github.sirbughunter.agenticwear.ui.AwRowText
import io.github.sirbughunter.agenticwear.ui.AwScrollColumn
import io.github.sirbughunter.agenticwear.ui.AwSectionLabel
import io.github.sirbughunter.agenticwear.ui.AwTimeText
import io.github.sirbughunter.agenticwear.ui.AwType
import io.github.sirbughunter.agenticwear.ui.AgenticWearTheme
import io.github.sirbughunter.agenticwear.ui.CloudOrb
import io.github.sirbughunter.agenticwear.ui.OrbMode
import io.github.sirbughunter.agenticwear.ui.ShimmerText
import io.github.sirbughunter.agenticwear.ui.StatusIndicator
import io.github.sirbughunter.agenticwear.ui.StatusKind
import io.github.sirbughunter.agenticwear.ui.callActive
import io.github.sirbughunter.agenticwear.ui.orbMode
import io.github.sirbughunter.agenticwear.ui.orbPalette
import io.github.sirbughunter.agenticwear.ui.toDotMood
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class LiveVoiceActivity : ComponentActivity() {
    private var startNewAfterPermission = false
    private var permissionPending = false
    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        permissionPending = false
        val startNew = startNewAfterPermission
        startNewAfterPermission = false
        if (granted && !isFinishing) connect(startNew)
        else LiveVoiceService.state.value = LiveVoiceState("error", "Microphone access is needed to talk; no task was created")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Cross-fade with the home screen rather than sliding, so a selected Dot appears to stay in place.
        if (Build.VERSION.SDK_INT >= 34) {
            overrideActivityTransition(Activity.OVERRIDE_TRANSITION_OPEN, android.R.anim.fade_in, android.R.anim.fade_out)
            overrideActivityTransition(Activity.OVERRIDE_TRANSITION_CLOSE, android.R.anim.fade_in, android.R.anim.fade_out)
        }
        startNewAfterPermission = savedInstanceState?.getBoolean("start-new-after-permission") ?: false
        permissionPending = savedInstanceState?.getBoolean("permission-pending") ?: false
        val autoConnect = intent.getBooleanExtra(EXTRA_AUTO_CONNECT, false)
        setContent {
            AgenticWearTheme {
                val liveState by LiveVoiceService.state.collectAsState()
                var preview by remember { mutableStateOf(demoState(intent.getStringExtra(MainActivity.EXTRA_DEMO_STATE))) }
                LaunchedEffect(Unit) {
                    val demo = intent.getStringExtra(MainActivity.EXTRA_DEMO_STATE)
                    if (BuildConfig.DEBUG && demo in setOf("live-bounce", "live-output-bounce")) {
                        for (level in listOf(0f, .8f, 0f, .3f, 1f, 0f)) {
                            preview = if (demo == "live-output-bounce") preview?.copy(outputLevel = level) else preview?.copy(inputLevel = level)
                            kotlinx.coroutines.delay(700)
                        }
                    }
                }
                val state = preview ?: liveState
                val preferences = remember { AppPreferences(this) }
                val demoColour = if (BuildConfig.DEBUG && preview != null) intent.getStringExtra(EXTRA_DEMO_COLOUR) else null
                val palette = remember { LiveVoiceColour.fromLabel(demoColour ?: preferences.liveVoiceColour).orbPalette() }
                val scope = rememberCoroutineScope()
                val repository = remember { AgenticWearRepository(this) }
                val creating = state.phase == "creating"
                var selectedThread by remember { mutableStateOf(preferences.selectedThreadId) }
                LaunchedEffect(state.taskId) { if (state.taskId.isNotBlank()) selectedThread = state.taskId }
                val thread = selectedThread
                val taskToOpen = state.taskToOpen(thread)
                val title = state.taskTitle.ifBlank { preferences.sessions.firstOrNull { it.id == thread }?.title ?: "No chat selected" }
                var cooldownSeconds by remember(thread) {
                    mutableIntStateOf(nativeCallCooldownSeconds(NativeCallCooldownStore.remainingMs(this@LiveVoiceActivity, thread)))
                }
                LaunchedEffect(thread, state.phase) {
                    while (true) {
                        cooldownSeconds = nativeCallCooldownSeconds(NativeCallCooldownStore.remainingMs(this@LiveVoiceActivity, thread))
                        if (cooldownSeconds == 0) break
                        kotlinx.coroutines.delay(250)
                    }
                }
                // A Dot call is known from the selected chat before the call's task id arrives.
                val isDotCall = state.taskId.ifBlank { thread.orEmpty() }.startsWith("dot:")
                val dotLook = remember(isDotCall) { if (isDotCall) io.github.sirbughunter.agenticwear.ui.DotAvatar.fromLabel(preferences.dotAvatar) else null }
                val callPalette = remember(dotLook) { dotLook?.orbPalette() ?: palette }
                val callDot = if (preferences.dotCallVisual == "Orb") null else dotLook
                val canConnect = BuildConfig.LIVE_VOICE_RUNTIME && thread != null && state.phase != "ending" && !creating && cooldownSeconds == 0

                fun start() {
                    if (preview == null) requestConnection(startNew = false)
                }
                LaunchedEffect(Unit) {
                    if (autoConnect && preview == null && !state.callActive() && canConnect) start()
                }
                fun openTask() {
                    if (preview == null) cancelPendingStart()
                    val target = Intent(this, MainActivity::class.java)
                    if (preview != null) target.putExtra(MainActivity.EXTRA_DEMO_STATE, "chat")
                    else target.putExtra(MainActivity.EXTRA_THREAD_ID, taskToOpen)
                    startActivity(target)
                }
                fun decide(approve: Boolean) {
                    val id = state.decisionRequestId() ?: return
                    if (preview != null) {
                        preview = preview?.copy(approvalId = null, approvalDetail = "", canApprove = false, deciding = false,
                            taskPhase = "completed", taskDetail = if (approve) "Demo approved locally · nothing sent" else "Demo declined locally · nothing sent")
                        return
                    }
                    if (LiveVoiceService.state.value.decisionRequestId() != id) return
                    LiveVoiceService.state.value = LiveVoiceService.state.value.copy(deciding = true)
                    scope.launch {
                        try { repository.respondToApproval(id, approve) }
                        catch (cancelled: CancellationException) { throw cancelled }
                        catch (error: Exception) {
                            if (LiveVoiceService.state.value.approvalId == id)
                                LiveVoiceService.state.value = LiveVoiceService.state.value.copy(deciding = false,
                                    taskDetail = error.message ?: "Decision was not acknowledged. Open the task in Codex.")
                        }
                    }
                }
                fun createTask() {
                    if (preview == null) requestConnection(startNew = true)
                }

                val hasDot = callDot != null
                // The surrounding UI rises in on first composition; the Dot is visible from the first frame.
                val entered = remember { MutableTransitionState(!hasDot).apply { targetState = true } }
                Box(Modifier.fillMaxSize().background(Aw.Bg)) {
                    if (callDot != null) CallDotLayer(callDot, state)
                    AnimatedVisibility(
                        visibleState = entered,
                        enter = if (hasDot) fadeIn(tween(420, easing = FastOutSlowInEasing)) +
                            slideInVertically(tween(420, easing = FastOutSlowInEasing)) { it / 10 } else EnterTransition.None,
                        exit = androidx.compose.animation.ExitTransition.None,
                    ) {
                    AnimatedContent(
                        targetState = state.callActive(),
                        transitionSpec = {
                            if (hasDot) (fadeIn(tween(420, easing = FastOutSlowInEasing)) +
                                slideInVertically(tween(420, easing = FastOutSlowInEasing)) { it / 10 }) togetherWith fadeOut(tween(260))
                            else fadeIn(tween(300)) togetherWith fadeOut(tween(200))
                        },
                        label = "call layout",
                    ) { active ->
                        if (active) {
                            CallInProgress(
                                state = state,
                                title = title,
                                palette = callPalette,
                                hasDot = hasDot,
                                controlsEnabled = true,
                                canOpenTask = taskToOpen != null,
                                onOpenTask = ::openTask,
                                onMute = {
                                    if (preview != null) preview = preview?.copy(muted = !state.muted)
                                    else LiveVoiceService.mute(this@LiveVoiceActivity)
                                },
                                onEnd = {
                                    if (preview != null) preview = LiveVoiceState(detail = "Demo ended · nothing sent")
                                    else { LiveVoiceService.end(this@LiveVoiceActivity); finish() }
                                },
                            )
                        } else {
                            CallIdle(
                                state = state,
                                title = title,
                                palette = callPalette,
                                hasDot = hasDot,
                                canConnect = canConnect,
                                cooldownSeconds = cooldownSeconds,
                                creating = creating,
                                canCreate = BuildConfig.LIVE_VOICE_RUNTIME && !creating && !preferences.pending && state.phase != "ending",
                                canOpenTask = taskToOpen != null,
                                onStart = ::start,
                                onCreateTask = ::createTask,
                                onOpenTask = ::openTask,
                                onUsePhonon = {
                                    preferences.transcriptionEngine = TranscriptionEngine.BRIDGE_PHONON
                                    sendBroadcast(Intent(AgenticWearRepository.ACTION_STATE_CHANGED).setPackage(packageName))
                                    finish()
                                },
                            )
                        }
                    }
                    }
                    AwDialog(visible = state.approvalId != null, onDismiss = { finish() }) {
                        val controls = state.hasCurrentApproval() && (preview != null || preferences.approvalMode == ApprovalMode.ALLOW_CONTROLS)
                        AwScrollColumn(topPadding = 34.dp, bottomPadding = 30.dp) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                Icon(Icons.Rounded.Security, contentDescription = null, tint = Aw.Attention, modifier = Modifier.size(15.dp))
                                Text("Approval needed", color = Aw.Attention, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            }
                            Text(state.approvalDetail, style = AwType.Body.copy(fontSize = 12.5.sp, lineHeight = 17.sp), textAlign = TextAlign.Center)
                            if (controls) {
                                Spacer(Modifier.height(4.dp))
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    AwPillButton("Decline", { decide(false) }, enabled = !state.deciding, modifier = Modifier.weight(1f))
                                    AwPillButton(if (state.deciding) "Sending…" else "Approve", { decide(true) }, primary = true,
                                        enabled = !state.deciding, modifier = Modifier.weight(1f))
                                }
                                Text("This turn only", style = AwType.Micro)
                            } else {
                                Text(
                                    when {
                                        state.canApprove -> "Decide in Codex, or allow watch controls in Settings › Approvals."
                                        state.phase != "live" -> "Read only while disconnected. Open the task in Codex."
                                        else -> "This request needs a decision in Codex."
                                    },
                                    style = AwType.Caption, textAlign = TextAlign.Center,
                                )
                            }
                            AwRowCard(onClick = ::openTask, enabled = taskToOpen != null, container = Color.Transparent, minHeight = 42.dp) {
                                Spacer(Modifier.weight(1f))
                                Icon(Icons.Rounded.OpenInNew, contentDescription = null, tint = Aw.TextSecondary, modifier = Modifier.size(14.dp))
                                Text("Open task", style = AwType.Label.copy(color = Aw.Text))
                                Spacer(Modifier.weight(1f))
                            }
                            AwRowCard(onClick = { LiveVoiceService.end(this@LiveVoiceActivity); finish() }, enabled = preview == null,
                                container = Color.Transparent, minHeight = 42.dp) {
                                Spacer(Modifier.weight(1f))
                                Text("End call", color = Aw.ErrorText, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                                Spacer(Modifier.weight(1f))
                            }
                        }
                    }
                    AwTimeText()
                }
            }
        }
    }

    @Suppress("DEPRECATION")
    override fun finish() {
        super.finish()
        if (Build.VERSION.SDK_INT < 34) overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("start-new-after-permission", startNewAfterPermission)
        outState.putBoolean("permission-pending", permissionPending)
        super.onSaveInstanceState(outState)
    }

    private fun requestConnection(startNew: Boolean) {
        if (!startNew && NativeCallCooldownStore.remainingMs(this, AppPreferences(this).selectedThreadId) > 0) return
        if (!canRequestVoiceStart(LiveVoiceService.state.value.phase, permissionPending)) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) connect(startNew)
        else {
            permissionPending = true
            startNewAfterPermission = startNew
            permission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    private fun cancelPendingStart() {
        startNewAfterPermission = false
        if (LiveVoiceService.state.value.phase in setOf("creating", "connecting")) LiveVoiceService.end(this)
    }

    override fun onStop() {
        if (isFinishing) cancelPendingStart()
        super.onStop()
    }

    private fun connect(startNew: Boolean = false) {
        val thread = AppPreferences(this).selectedThreadId
        if (!startNew && thread == null) return
        runCatching { if (startNew) LiveVoiceService.beginNew(this) else LiveVoiceService.begin(this, thread!!) }.onFailure {
            LiveVoiceService.state.value = LiveVoiceState("error", it.message ?: "Could not start live voice")
        }
    }

    private fun demoState(name: String?): LiveVoiceState? = if (!BuildConfig.DEBUG) null else when (name) {
        "live-working" -> LiveVoiceState(phase = "live", taskTitle = "Voice with Codex", taskContext = "/tmp/demo\ngpt-6.1-sol · high",
            taskPhase = "working", taskDetail = "Running a command")
        "live-speaking", "live-output-bounce" -> LiveVoiceState(phase = "live", taskTitle = "Voice with Codex", mediaActivity = "speaking", outputLevel = 0.3f,
            caption = "Backoff now caps at thirty seconds, with jitter.")
        "live-permission" -> LiveVoiceState(phase = "live", taskTitle = "Voice with Codex", taskPhase = "approval",
            approvalId = "demo-only", approvalDetail = "Read the requested test folder?\nFolder: /tmp/demo\nRequested permissions for this turn: read /tmp/demo", canApprove = true)
        "live-reconnecting-permission" -> LiveVoiceState(phase = "reconnecting", detail = "Connection interrupted…", taskTitle = "Voice with Codex", taskPhase = "approval",
            approvalId = "demo-only", approvalDetail = "Previous request: read /tmp/demo", canApprove = false)
        "live-listening", "live-bounce" -> LiveVoiceState(phase = "live", taskTitle = "Voice with Codex", mediaActivity = "listening", inputLevel = .25f)
        "live-muted" -> LiveVoiceState(phase = "live", taskTitle = "Voice with Codex", mediaActivity = "listening", muted = true, inputLevel = 1f)
        "live-creating" -> LiveVoiceState(phase = "creating", detail = "Creating local voice task…", taskTitle = "New voice task")
        "live-connecting" -> LiveVoiceState(phase = "connecting", detail = "Connecting…", taskTitle = "Voice with Codex")
        "live-reconnecting" -> LiveVoiceState(phase = "reconnecting", detail = "Connection interrupted…", taskTitle = "Voice with Codex")
        "live-connected" -> LiveVoiceState(phase = "live", taskTitle = "Voice with Codex")
        "live-muted-speaking" -> LiveVoiceState(phase = "live", muted = true, outputLevel = .6f, mediaActivity = "speaking")
        "live-idle", "live-ready" -> LiveVoiceState(taskTitle = "Voice with Codex")
        else -> null
    }?.let { if (it.phase == "creating") it else it.copy(taskId = "demo-build") }

    companion object {
        internal val DEMO_STATES = setOf("live-creating", "live-connecting", "live-reconnecting", "live-ready", "live-connected", "live-idle",
            "live-working", "live-speaking", "live-output-bounce", "live-permission", "live-reconnecting-permission",
            "live-listening", "live-bounce", "live-muted", "live-muted-speaking")
        const val EXTRA_DEMO_COLOUR = "io.github.sirbughunter.agenticwear.DEMO_ORB_COLOUR"
        const val EXTRA_AUTO_CONNECT = "io.github.sirbughunter.agenticwear.LIVE_AUTO_CONNECT"
    }
}

@Composable
private fun CallInProgress(
    state: LiveVoiceState,
    title: String,
    palette: io.github.sirbughunter.agenticwear.ui.OrbPalette,
    hasDot: Boolean,
    controlsEnabled: Boolean,
    canOpenTask: Boolean,
    onOpenTask: () -> Unit,
    onMute: () -> Unit,
    onEnd: () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = maxWidth
        val h = maxHeight
        // A Dot call keeps the figure exactly where the home screen draws it (see CallDotLayer).
        val orb = if (hasDot) w * .4f * .86f else w * 0.28f
        val orbCenterY = if (hasDot) h * .425f else h * 0.415f
        Column(
            Modifier.align(Alignment.TopCenter).padding(top = h * 0.105f).padding(horizontal = w * 0.17f),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(title, style = AwType.Title.copy(fontSize = 13.sp), maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            CallDurationText(state)
            val label = state.activityLabel()
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
                when {
                    state.phase == "reconnecting" -> { StatusIndicator(StatusKind.Attention); Text("Reconnecting…", color = Aw.Attention, fontSize = 11.sp) }
                    state.phase == "creating" -> ShimmerText("Creating task", fontSize = 11.sp)
                    state.phase == "connecting" -> ShimmerText("Connecting", fontSize = 11.sp)
                    state.taskPhase in setOf("handoff", "working") && state.outputLevel <= .01f -> ShimmerText(label, fontSize = 11.sp)
                    else -> Text(label, style = AwType.Caption, maxLines = 1)
                }
            }
        }
        if (!hasDot) CloudOrb(
            palette = palette,
            mode = state.orbMode(),
            userLevel = if (state.muted) 0f else state.inputLevel,
            agentLevel = state.outputLevel,
            description = state.activityLabel(),
            modifier = Modifier.offset(x = (w - orb) / 2, y = orbCenterY - orb / 2).size(orb),
        )
        // Caption, or the task in progress, under the orb.
        val under = when {
            state.caption.isNotBlank() -> state.caption
            state.taskDetail.isNotBlank() && state.taskDetail != state.activityLabel() -> state.taskDetail
            else -> ""
        }
        if (under.isNotBlank()) {
            Text(
                under,
                color = if (state.outputLevel > .01f || state.mediaActivity == "speaking") Aw.Text else Aw.TextSecondary,
                fontSize = 11.5.sp, lineHeight = 14.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = orbCenterY + orb / 2 + 6.dp).padding(horizontal = w * 0.15f),
            )
        }
        Row(
            Modifier.align(Alignment.BottomCenter).padding(bottom = h * 0.12f),
            horizontalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            AwCircleButton(
                if (state.muted) Icons.Rounded.MicOff else Icons.Rounded.Mic,
                if (state.muted) "Unmute microphone" else "Mute microphone",
                onClick = { haptics.performHapticFeedback(HapticFeedbackType.ToggleOn); onMute() },
                size = 48.dp,
                container = if (state.muted) Aw.Text else Aw.SurfaceHigh,
                content = if (state.muted) Aw.OnPrimary else Aw.Text,
                bordered = false,
                enabled = controlsEnabled && state.phase != "creating",
            )
            AwCircleButton(
                Icons.Rounded.OpenInNew, "Open task",
                onClick = onOpenTask,
                size = 48.dp, container = Aw.SurfaceHigh, bordered = false,
                enabled = canOpenTask,
            )
            AwCircleButton(
                Icons.Rounded.CallEnd, if (state.phase in setOf("creating", "connecting")) "Cancel voice startup" else "End call",
                onClick = { haptics.performHapticFeedback(HapticFeedbackType.Reject); onEnd() },
                size = 48.dp, container = Aw.End, content = Color.White, bordered = false, enabled = controlsEnabled,
            )
        }
    }
}

@Composable
private fun CallIdle(
    state: LiveVoiceState,
    title: String,
    palette: io.github.sirbughunter.agenticwear.ui.OrbPalette,
    hasDot: Boolean,
    canConnect: Boolean,
    cooldownSeconds: Int,
    creating: Boolean,
    canCreate: Boolean,
    canOpenTask: Boolean,
    onStart: () -> Unit,
    onCreateTask: () -> Unit,
    onOpenTask: () -> Unit,
    onUsePhonon: () -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        // A Dot is drawn by CallDotLayer at the home screen's position; leave room for it here.
        val dotBottom = maxHeight * .425f + maxWidth * .4f * .86f / 2 + 14.dp
        val headerTop = maxHeight * .105f
        AwScrollColumn(topPadding = if (hasDot) headerTop else 30.dp, bottomPadding = 76.dp) {
            if (hasDot) {
                Text(title, style = AwType.Title.copy(fontSize = 13.sp), maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                Spacer(Modifier.height((dotBottom - headerTop - 24.dp).coerceAtLeast(0.dp)))
            } else {
                Text("Live voice", style = AwType.Title)
                Text(title, style = AwType.Caption, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                CloudOrb(palette, if (state.phase == "error") OrbMode.Disabled else OrbMode.Idle, 0f, 0f, Modifier.padding(vertical = 4.dp).size(58.dp))
            }
            val message = when {
                cooldownSeconds > 0 -> "Lumen is finishing its previous call. Ready in ${cooldownSeconds}s."
                !BuildConfig.LIVE_VOICE_RUNTIME -> "This build doesn’t include the live voice runtime."
                state.phase == "error" -> state.detail
                state.phase == "ending" -> "Ending call…"
                else -> state.detail
            }
            CallDurationText(state)
            Text(message, color = if (state.phase == "error" && cooldownSeconds == 0) Aw.ErrorText else Aw.TextSecondary, fontSize = 11.sp, lineHeight = 14.sp, textAlign = TextAlign.Center)
            Spacer(Modifier.height(6.dp))
            AwSectionLabel("Options")
            AwRowCard(onClick = onCreateTask, enabled = canCreate) {
                Icon(Icons.Rounded.Add, contentDescription = null, tint = Aw.TextSecondary, modifier = Modifier.size(17.dp))
                AwRowText(if (creating) "Creating task…" else "New voice task", "Empty Codex task in the bridge’s default folder", Modifier.weight(1f))
            }
            AwRowCard(onClick = onOpenTask, enabled = canOpenTask) {
                Icon(Icons.Rounded.OpenInNew, contentDescription = null, tint = Aw.TextSecondary, modifier = Modifier.size(16.dp))
                AwRowText("Open task", null, Modifier.weight(1f))
            }
            AwRowCard(onClick = onUsePhonon) {
                Icon(Icons.Rounded.Mic, contentDescription = null, tint = Aw.TextSecondary, modifier = Modifier.size(16.dp))
                AwRowText("Use Phonon dictation", "Runs on your Mac when live voice is unavailable", Modifier.weight(1f))
            }
            Text("Uses Codex’s live voice connection. Account availability is checked when connecting. Your dot isn’t linked to this connection.",
                style = AwType.Micro, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
        }
        AwEdgeButton(
            label = if (cooldownSeconds > 0) "Ready in ${cooldownSeconds}s" else if (state.phase == "error") "Try again" else "Start call",
            enabled = canConnect,
            onClick = onStart,
        )
    }
}

/**
 * The call's Dot, drawn once above the cross-fading idle/in-progress layouts so it never fades or
 * resizes. It sits exactly where the home screen draws it: 0.4 × 0.86 of the width, centred at 42.5% height.
 */
@Composable
private fun CallDotLayer(avatar: io.github.sirbughunter.agenticwear.ui.DotAvatar, state: LiveVoiceState) {
    val mode = state.orbMode()
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val figure = maxWidth * .4f * .86f
        io.github.sirbughunter.agenticwear.ui.DotCallFigure(
            avatar = avatar,
            mood = mode.toDotMood(),
            connecting = mode == OrbMode.Connecting || mode == OrbMode.Reconnecting,
            userLevel = if (state.muted) 0f else state.inputLevel,
            agentLevel = state.outputLevel,
            modifier = Modifier.offset(x = (maxWidth - figure) / 2, y = maxHeight * .425f - figure / 2).size(figure)
                .semantics { contentDescription = state.activityLabel() },
        )
    }
}

/** UI-only ticker: no service wakeup or network request is added. */
@Composable
private fun CallDurationText(state: LiveVoiceState) {
    var now by remember(state.connectedAtElapsedMs) { mutableLongStateOf(android.os.SystemClock.elapsedRealtime()) }
    LaunchedEffect(state.connectedAtElapsedMs, state.finishedDurationMs) {
        if (state.connectedAtElapsedMs == null || state.finishedDurationMs != null) return@LaunchedEffect
        while (true) {
            now = android.os.SystemClock.elapsedRealtime()
            kotlinx.coroutines.delay(1000)
        }
    }
    liveCallDurationMs(state.connectedAtElapsedMs, state.finishedDurationMs, now)?.let {
        Text("${if (state.finishedDurationMs != null) "Last call · " else ""}${formatLiveCallDuration(it)}",
            style = AwType.Caption, fontSize = 11.sp, maxLines = 1, textAlign = TextAlign.Center)
    }
}
