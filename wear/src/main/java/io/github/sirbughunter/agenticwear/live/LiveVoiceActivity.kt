package io.github.sirbughunter.agenticwear.live

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
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

                Box(Modifier.fillMaxSize().background(Aw.Bg)) {
                    AnimatedContent(
                        targetState = state.callActive(),
                        transitionSpec = { fadeIn(tween(300)) togetherWith fadeOut(tween(200)) },
                        label = "call layout",
                    ) { active ->
                        if (active) {
                            CallInProgress(
                                state = state,
                                title = title,
                                palette = palette,
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
                                palette = palette,
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
        val orb = w * 0.28f
        val orbCenterY = h * 0.415f
        Column(
            Modifier.align(Alignment.TopCenter).padding(top = h * 0.105f).padding(horizontal = w * 0.17f),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(title, style = AwType.Title.copy(fontSize = 13.sp), maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
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
        val context = androidx.compose.ui.platform.LocalContext.current
        val prefs = remember { AppPreferences(context) }
        val dotAvatar = remember { if (prefs.dotCallVisual == "Orb") null else io.github.sirbughunter.agenticwear.ui.DotAvatar.fromLabel(prefs.dotAvatar) }
        if (dotAvatar != null && state.taskId.startsWith("dot:")) {
            val figure = orb * 1.45f
            val mode = state.orbMode()
            io.github.sirbughunter.agenticwear.ui.DotCallFigure(
                avatar = dotAvatar,
                palette = palette,
                mood = when (mode) {
                    OrbMode.Listening -> io.github.sirbughunter.agenticwear.ui.DotMood.LISTENING
                    OrbMode.Speaking -> io.github.sirbughunter.agenticwear.ui.DotMood.SPEAKING
                    OrbMode.Thinking -> io.github.sirbughunter.agenticwear.ui.DotMood.THINKING
                    OrbMode.Approval -> io.github.sirbughunter.agenticwear.ui.DotMood.NEEDS
                    OrbMode.Muted, OrbMode.Reconnecting, OrbMode.Disabled -> io.github.sirbughunter.agenticwear.ui.DotMood.FROZEN
                    else -> io.github.sirbughunter.agenticwear.ui.DotMood.IDLE
                },
                connecting = mode == OrbMode.Connecting || mode == OrbMode.Reconnecting,
                userLevel = if (state.muted) 0f else state.inputLevel,
                agentLevel = state.outputLevel,
                modifier = Modifier.offset(x = (w - figure) / 2, y = orbCenterY - figure / 2).size(figure)
                    .semantics { contentDescription = state.activityLabel() },
            )
        } else CloudOrb(
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
    Box(Modifier.fillMaxSize()) {
        AwScrollColumn(topPadding = 30.dp, bottomPadding = 76.dp) {
            Text("Live voice", style = AwType.Title)
            Text(title, style = AwType.Caption, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            val context = androidx.compose.ui.platform.LocalContext.current
            val prefs = remember { AppPreferences(context) }
            if (state.taskId.startsWith("dot:") && prefs.dotCallVisual != "Orb") {
                io.github.sirbughunter.agenticwear.ui.DotFigure(
                    io.github.sirbughunter.agenticwear.ui.DotAvatar.fromLabel(prefs.dotAvatar),
                    if (state.phase == "error") io.github.sirbughunter.agenticwear.ui.DotMood.FROZEN else io.github.sirbughunter.agenticwear.ui.DotMood.IDLE,
                    Modifier.padding(vertical = 6.dp).size(58.dp),
                )
            } else CloudOrb(palette, if (state.phase == "error") OrbMode.Disabled else OrbMode.Idle, 0f, 0f, Modifier.padding(vertical = 4.dp).size(58.dp))
            val message = when {
                cooldownSeconds > 0 -> "Lumen is finishing its previous call. Ready in ${cooldownSeconds}s."
                !BuildConfig.LIVE_VOICE_RUNTIME -> "This build doesn’t include the live voice runtime."
                state.phase == "error" -> state.detail
                state.phase == "ending" -> "Ending call…"
                else -> state.detail
            }
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
