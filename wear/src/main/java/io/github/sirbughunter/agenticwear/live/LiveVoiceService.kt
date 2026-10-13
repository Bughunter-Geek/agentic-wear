package io.github.sirbughunter.agenticwear.live

import android.app.*
import android.content.*
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import io.github.sirbughunter.agenticwear.BuildConfig
import io.github.sirbughunter.agenticwear.R
import io.github.sirbughunter.agenticwear.data.AppPreferences
import io.github.sirbughunter.agenticwear.voice.VoiceSessionPhase
import io.github.sirbughunter.agenticwear.voice.VoiceSessionService
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.json.JSONObject

data class LiveVoiceState(val phase: String = "idle", val detail: String = "Choose a task, then Connect",
    val muted: Boolean = false, val caption: String = "", val taskId: String = "", val taskTitle: String = "", val taskContext: String = "",
    val taskPhase: String = "", val taskDetail: String = "", val mediaActivity: String = "ready",
    val inputLevel: Float = 0f, val outputLevel: Float = 0f, val approvalId: String? = null,
    val approvalDetail: String = "", val canApprove: Boolean = false, val deciding: Boolean = false)

/** Poll the relay inbox quickly while the SDP answer is pending, then at the steady in-call rate. */
internal fun livePollIntervalMs(mediaConnected: Boolean): Long =
    if (mediaConnected) LiveVoiceService.CALL_POLL_MS else LiveVoiceService.STARTUP_POLL_MS

/** Separate foreground owner: wrist-down does not turn a live call into a stopped recording. */
class LiveVoiceService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    @Volatile private var peer: LivePeer? = null
    private lateinit var signaling: LiveSignaling
    private lateinit var audio: AudioManager
    private var focus: AudioFocusRequest? = null
    private var oldMode = AudioManager.MODE_NORMAL
    private var wakeLock: PowerManager.WakeLock? = null
    private var callId: String? = null
    private var ending = false
    private var nativeDotCall = false
    private var pollJob: Job? = null
    private var eventsJob: Job? = null
    private var heartbeatJob: Job? = null
    private var disconnectJob: Job? = null
    private var startupJob: Job? = null
    private var levelsJob: Job? = null
    private var speaking = false
    private var network: VoiceNetwork? = null
    private var releaseNetworkMonitor: (() -> Unit)? = null
    private var readiness = NativeVoiceReadiness()

    override fun onCreate() {
        super.onCreate()
        signaling = LiveSignaling(this)
        audio = getSystemService(AudioManager::class.java)
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Live voice", NotificationManager.IMPORTANCE_LOW))
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            BEGIN -> begin(intent.getStringExtra("thread"))
            BEGIN_NEW -> begin(null, createNew = true)
            END -> end()
            MUTE -> {
                val muted = !state.value.muted
                peer?.mute(readiness.effectiveMute(muted))
                state.value = state.value.copy(muted = muted)
                getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification())
            }
        }
        return START_NOT_STICKY
    }
    private fun begin(thread: String?, createNew: Boolean = false) {
        if (callId != null || ending) return
        if (createNew && newTaskPending) {
            state.value = LiveVoiceState("error", "Task creation is still pending. Wait for its reply before retrying.")
            stopSelf(); return
        }
        if (!BuildConfig.LIVE_VOICE_RUNTIME || (!createNew && thread.isNullOrBlank())) {
            state.value = LiveVoiceState("error", "Choose a task and install the private WebRTC build first")
            stopSelf(); return
        }
        nativeDotCall = false
        val prefs = AppPreferences(this)
        if (prefs.pending || VoiceSessionService.sessionState.value.phase in setOf(VoiceSessionPhase.RECORDING, VoiceSessionPhase.TRANSCRIBING)) {
            state.value = LiveVoiceState("error", "Finish dictation before connecting live voice")
            stopSelf(); return
        }
        callId = UUID.randomUUID().toString()
        VoiceTrace.begin(callId!!, thread.orEmpty())
        ending = false
        speaking = false
        readiness = NativeVoiceReadiness()
        state.value = LiveVoiceState(if (createNew) "creating" else "connecting",
            if (createNew) "Creating local voice task…" else "Checking Codex voice…", taskId = thread.orEmpty())
        try {
            ServiceCompat.startForeground(this, NOTIFICATION, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            oldMode = audio.mode
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setOnAudioFocusChangeListener { change ->
                    if (change < 0) end("Audio was interrupted. Reconnect when ready.")
                }.build()
            focus = request
            check(audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { "Audio is busy. Try again after the current call." }
            audio.mode = AudioManager.MODE_IN_COMMUNICATION
            wakeLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:live-voice").apply {
                setReferenceCounted(false); acquire(2L * 60L * 60L * 1000L)
            }
        } catch (error: Exception) { end(error.message ?: "Could not start live voice"); return }
        // Bound resources for both task initialization and conversational media.
        scope.launch { delay(2L * 60L * 60L * 1000L); end("Two-hour safety limit reached. Reconnect to continue.") }
        if (createNew) {
            newTaskPending = true
            val expectedCall = callId
            startupJob = scope.launch {
                try {
                    createAndConnectVoiceTask(
                        create = {
                            try {
                                val task = signaling.createTask()
                                CreatedVoiceTask(task.getString("id"), task.optString("title"))
                            } finally { newTaskPending = false }
                        },
                        stillCurrent = { !ending && callId == expectedCall },
                        select = { task ->
                            prefs.selectedThreadId = task.id
                            sendBroadcast(Intent(io.github.sirbughunter.agenticwear.data.AgenticWearRepository.ACTION_STATE_CHANGED).setPackage(packageName))
                        },
                        connect = { task ->
                            state.value = state.value.copy(phase = "connecting", detail = "Connecting voice…", taskId = task.id, taskTitle = task.title)
                            startConnection(task.id)
                        },
                    )
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) {
                    if (!ending) end(error.message ?: "Task creation is not confirmed. Retry checks the same request.")
                }
            }
        } else startConnection(thread!!)
    }

    private fun startConnection(thread: String) {
        LiveSignaling.discardOldEvents()
        val capability = CompletableDeferred<JSONObject>()
        val nativeDotCatalog = CompletableDeferred<Boolean>()
        val firstMediaConnection = CompletableDeferred<Unit>()
        val expectedCall = callId ?: return
        val gate = readiness
        var transportSeq = 0
        fun activateWhenReady() {
            if (gate.ready && !ending && callId == expectedCall) {
                peer?.mute(gate.effectiveMute(state.value.muted))
                firstMediaConnection.complete(Unit)
                disconnectJob?.cancel(); state.value = state.value.withConnection(true)
            }
        }
        var capabilityId: String? = null
        var answerApplied = false
        eventsJob = scope.launch {
            for (event in LiveSignaling.events) {
                if (event.optString("kind") == "live.capability" && event.optString("requestId") == capabilityId) {
                    capability.complete(event); continue
                }
                if (event.optString("kind") == "live.error" && event.optString("requestId") == capabilityId) {
                    capability.completeExceptionally(IllegalStateException(event.optString("message", "Could not check Codex voice"))); continue
                }
                if (event.optString("callId") != callId || ending) continue
                when (event.optString("kind")) {
                    "live.ready" -> { gate.accepted(); activateWhenReady() }
                    "live.answer" -> if (answerApplied) {
                        // A repeated answer must not renegotiate the established session.
                        VoiceTrace.event(VoiceTraceStage.ANSWER_DUPLICATE)
                    } else try {
                        answerApplied = true
                        VoiceTrace.event(VoiceTraceStage.ANSWER_RECEIVED)
                        peer?.answer(event.getString("sdp"))
                        VoiceTrace.event(VoiceTraceStage.ANSWER_APPLIED)
                    } catch (error: LinkageError) { VoiceTrace.error(VoiceTraceStage.ANSWER_FAILED, error); end("Voice runtime could not initialize. Phonon dictation is still available.") } catch (error: Exception) { VoiceTrace.error(VoiceTraceStage.ANSWER_FAILED, error); end("Voice negotiation failed") }
                    "live.closed" -> end(event.optString("reason", "Voice connection ended"))
                    "live.error" -> end(event.optString("message", "Codex voice failed"))
                    "live.task" -> {
                        val approval = event.optString("approvalId").takeIf { it.isNotBlank() }
                        val finished = event.optString("phase") in setOf("completed", "failed", "interrupted") ||
                            event.optString("resolvedApprovalId").takeIf { it.isNotBlank() } == state.value.approvalId
                        state.value = state.value.copy(taskPhase = event.optString("phase"), taskDetail = event.optString("detail").take(400),
                            approvalId = approval ?: state.value.approvalId.takeUnless { finished },
                            approvalDetail = if (approval != null) event.optString("approvalDetail").take(4000) else state.value.approvalDetail.takeUnless { finished }.orEmpty(),
                            canApprove = if (approval != null) event.optBoolean("canControl") && state.value.phase == "live"
                                else !finished && state.value.canApprove,
                            deciding = if (approval != null || finished) false else state.value.deciding)
                    }
                }
            }
        }
        pollJob = scope.launch(Dispatchers.IO) {
            var lastSuccess = SystemClock.elapsedRealtime()
            while (isActive && !ending) {
                try { signaling.poll(); lastSuccess = SystemClock.elapsedRealtime() }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) {
                    VoiceTrace.error(VoiceTraceStage.POLL_FAILED, error)
                    if (SystemClock.elapsedRealtime() - lastSuccess > 30_000) {
                        withContext(Dispatchers.Main) { end("Bridge disconnected. Reconnect when it is available.") }; return@launch
                    }
                }
                delay(livePollIntervalMs(firstMediaConnection.isCompleted))
            }
        }
        startupJob = scope.launch {
            try {
                // Give WebRTC's network monitor a head start; the first peer is created within ~0.1 s.
                if (releaseNetworkMonitor == null) releaseNetworkMonitor = runCatching { NativeLivePeer.warmUpNetworkMonitor(this@LiveVoiceService) }.getOrNull()
                // Wake a direct radio while checking the catalog. Only a Bluetooth
                // Dot needs that reply to permit the default-route transport.
                val initialTransport = (network ?: VoiceNetwork(this@LiveVoiceService).also { network = it }).currentTransport()
                VoiceTrace.event(VoiceTraceStage.NETWORK_REQUEST, initialTransport)
                val networkReady = async {
                    val bluetoothPermission = if (initialTransport == "BLUETOOTH" && thread.startsWith("dot:")) nativeDotCatalog else null
                    network!!.acquire(bluetoothDefaultRoute = bluetoothPermission)
                }
                var defaultNetworkRoute = false
                val createPeer = { NativeLivePeer(this@LiveVoiceService, { status ->
                    scope.launch {
                        if (ending || callId != expectedCall) return@launch
                        when (status) {
                            "connected" -> {
                                gate.connected(true); activateWhenReady()
                            }
                            "failed" -> end("Voice connection failed. Reconnect when ready.")
                            "disconnected" -> {
                                gate.connected(false)
                                state.value = state.value.withConnection(false)
                                disconnectJob?.cancel()
                                disconnectJob = scope.launch { delay(10_000); end("Voice disconnected. Reconnect when ready.") }
                            }
                            "listening", "thinking", "speaking", "ready" -> {
                                if (status == "speaking") speaking = true
                                if (status == "listening") speaking = false // A genuine barge-in event.
                                if (status == "ready") {
                                    // response.done may precede the last speaker samples. Stats
                                    // and the output-buffer stop event settle the audible state.
                                    speaking = false
                                }
                                state.value = state.value.copy(mediaActivity = status)
                            }
                            "response.done" -> if (!speaking) state.value = state.value.copy(mediaActivity = "ready")
                        }
                    }
                }, { caption -> scope.launch { if (!ending && callId == expectedCall) state.value = state.value.copy(caption = (state.value.caption + caption).takeLast(2000)) } },
                { remotePeer, remoteIce, remoteChannel -> scope.launch {
                    val id = callId
                    if (!ending && gate.requiresHostAcceptance && id == expectedCall) {
                        transportSeq++
                        val snapshot = JSONObject().put("seq", transportSeq).put("peerState", remotePeer)
                            .put("iceState", remoteIce).put("channelState", remoteChannel)
                        launch(Dispatchers.IO) {
                            try { signaling.send("live.transport", id, JSONObject().put("transport", snapshot)) }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: Exception) { /* The call lease bounds a lost transport-state update. */ }
                        }
                    }
                } }, { caption -> scope.launch { if (!ending && callId == expectedCall) state.value = state.value.copy(caption = caption.take(2000)) } },
                    defaultNetworkRoute = defaultNetworkRoute,
                ).also {
                    if (ending || callId != expectedCall) { it.close(); throw CancellationException("Previous voice call ended") }
                    peer = it; VoiceTrace.event(VoiceTraceStage.PEER_CREATED)
                } }
                // The offer does not depend on the capability reply, so build it while that round trip runs.
                // Failures are returned rather than thrown: a failed child would cancel startupJob before the
                // catch blocks below run (and a LinkageError would reach the uncaught-exception handler).
                val offerJob = async(Dispatchers.Default) {
                    try {
                        val transport = networkReady.await()
                        defaultNetworkRoute = transport == "BLUETOOTH" && nativeDotCatalog.await()
                        VoiceTrace.event(VoiceTraceStage.NETWORK_READY, transport)
                        VoiceTrace.event(VoiceTraceStage.OFFER_BEGIN)
                        Result.success(offerWithFreshPeers(createPeer,
                            offer = { created -> withTimeout(15_000) { created.offerWithMuteState(gate.effectiveMute(state.value.muted)) } },
                            retrying = { attempt -> VoiceTrace.event(VoiceTraceStage.OFFER_RETRY, count = attempt); peer = null },
                        ).second)
                    } catch (timeout: TimeoutCancellationException) { Result.failure(timeout) }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (error: Throwable) { Result.failure(error) }
                }
                val voice = try {
                    capabilityId = UUID.randomUUID().toString()
                    VoiceTrace.event(VoiceTraceStage.CAPABILITY_SEND)
                    withContext(Dispatchers.IO) { signaling.send("live.capability", fields = JSONObject().put("threadId", thread), requestId = capabilityId) }
                    VoiceTrace.event(VoiceTraceStage.CAPABILITY_POSTED)
                    val catalog = withTimeout(15_000) { capability.await() }
                    VoiceTrace.event(VoiceTraceStage.CAPABILITY_RECEIVED)
                    check(catalog.optBoolean("realtimeApiAvailable")) { "This Codex host has no compatible live voice interface" }
                    gate.configure(catalog.optBoolean("requiresHostReady"))
                    if (gate.requiresHostAcceptance) peer?.mute(true)
                    val defaultVoice = catalog.getJSONObject("voices").getString("defaultV1")
                    catalog.optJSONObject("task")?.let { task ->
                        fun text(key: String) = if (task.isNull(key)) "" else task.optString(key).take(250)
                        state.value = state.value.copy(taskTitle = text("title"),
                            taskContext = listOf(text("cwd"), listOf(text("model"), text("effort")).filter { it.isNotBlank() }.joinToString(" · "))
                                .filter { it.isNotBlank() }.joinToString("\n"))
                    }
                    nativeDotCall = catalog.optBoolean("nativeDot") && gate.requiresHostAcceptance
                    nativeDotCatalog.complete(nativeDotCall)
                    defaultVoice
                } catch (error: Throwable) { offerJob.cancel(); throw error }
                val offer = offerJob.await().getOrThrow()
                peer?.mute(gate.effectiveMute(state.value.muted))
                val id = callId ?: return@launch
                VoiceTrace.event(VoiceTraceStage.START_SEND)
                withContext(Dispatchers.IO) { signaling.send("live.start", id, JSONObject().put("threadId", thread).put("voice", voice).put("sdp", offer)) }
                VoiceTrace.event(VoiceTraceStage.START_POSTED)
                levelsJob = scope.launch {
                    while (isActive && !ending) {
                        peer?.levels { input, output -> scope.launch {
                            if (!ending) state.value = state.value.copy(inputLevel = if (state.value.muted) 0f else input,
                                outputLevel = output)
                        } }
                        delay(200)
                    }
                }
                heartbeatJob = scope.launch(Dispatchers.IO) {
                    maintainLiveHeartbeat(
                        now = SystemClock::elapsedRealtime,
                        wait = { delay(it) },
                        stillCurrent = { isActive && !ending && callId == id },
                        send = { signaling.send("live.heartbeat", id) },
                        lost = { withContext(Dispatchers.Main) {
                            if (!ending && callId == id) end("Bridge connection lost. Reconnect when ready.")
                        } },
                    )
                }
                if (!awaitLiveMediaStart(firstMediaConnection)) {
                    VoiceTrace.event(VoiceTraceStage.STARTUP_TIMEOUT)
                    end("Voice did not finish connecting. Your task is retained. Retry Connect to task; check the bridge if it fails again.")
                }
            } catch (timeout: TimeoutCancellationException) {
                // A timeout is a CancellationException too; without this the call would sit at "connecting".
                VoiceTrace.error(VoiceTraceStage.STARTUP_FAILED, timeout); end(STARTUP_TIMEOUT_MESSAGE)
            }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: LinkageError) { VoiceTrace.error(VoiceTraceStage.STARTUP_FAILED, error); end("Voice runtime could not initialize. Phonon dictation is still available.") }
            catch (error: Exception) { VoiceTrace.error(VoiceTraceStage.STARTUP_FAILED, error); end(error.message ?: "Could not connect Codex voice") }
        }
    }
    private fun end(reason: String? = null) {
        if (ending) return
        VoiceTrace.event(VoiceTraceStage.END)
        ending = true
        val id = callId
        if (id != null) NativeCallCooldownStore.ended(this, state.value.taskId, nativeDotCall)
        callId = null
        val trace = VoiceTrace.events()
        runCatching { peer?.close() }; peer = null
        network?.release(); network = null
        releaseNetworkMonitor?.invoke(); releaseNetworkMonitor = null
        pollJob?.cancel(); eventsJob?.cancel(); heartbeatJob?.cancel(); disconnectJob?.cancel(); startupJob?.cancel(); levelsJob?.cancel()
        releaseAudio()
        state.value = LiveVoiceState("ending", reason ?: "Ending call…")
        scope.launch(Dispatchers.IO) {
            try { if (id != null) withTimeout(10_000) { signaling.send("live.stop", id) } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* Bridge lease expires after 45 seconds if stop cannot arrive. */ }
            // Best effort: metadata-only call diagnostics (stages, timings, network type) for the bridge log.
            try { if (id != null && trace.isNotEmpty()) withTimeout(5_000) {
                signaling.send("live.trace", id, JSONObject().put("events", org.json.JSONArray(trace.map { JSONObject(it) })))
            } }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* Diagnostics never block ending the call. */ }
            finally { withContext(Dispatchers.Main) {
                state.value = LiveVoiceState(if (reason == null) "idle" else "error", reason ?: "Call ended · Connect to continue")
                ServiceCompat.stopForeground(this@LiveVoiceService, ServiceCompat.STOP_FOREGROUND_REMOVE); stopSelf()
            } }
        }
    }
    private fun releaseAudio() {
        focus?.let(audio::abandonAudioFocusRequest); focus = null
        if (audio.mode == AudioManager.MODE_IN_COMMUNICATION) audio.mode = oldMode
        wakeLock?.takeIf { it.isHeld }?.release(); wakeLock = null
    }
    override fun onTaskRemoved(rootIntent: Intent?) { end(); super.onTaskRemoved(rootIntent) }
    override fun onDestroy() {
        runCatching { peer?.close() }; peer = null; network?.release(); network = null
        releaseNetworkMonitor?.invoke(); releaseNetworkMonitor = null; releaseAudio(); scope.cancel()
        if (!ending && callId != null) state.value = LiveVoiceState("error", "Voice service stopped. Reconnect when ready.")
        callId = null
        super.onDestroy()
    }
    private fun notification(): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, LiveVoiceActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, LiveVoiceService::class.java).setAction(END), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_agent)
            .setContentTitle("Codex live voice").setContentText(if (state.value.phase == "creating") "Creating task · Cancel stops voice startup" else if (state.value.muted) "Microphone muted" else "Call continues with the screen off")
            .setContentIntent(open).setOngoing(true).setSilent(true).addAction(0, "End", stop).build()
    }
    companion object {
        val state = MutableStateFlow(LiveVoiceState())
        @Volatile private var newTaskPending = false
        private const val BEGIN_NEW = "live.begin-new"
        private const val BEGIN = "live.begin"
        private const val END = "live.end"
        private const val MUTE = "live.mute"
        private const val CHANNEL = "live_voice_v1"
        private const val NOTIFICATION = 7302
        /** Inbox poll cadence until the first media connection, then for the rest of the call. */
        internal const val STARTUP_POLL_MS = 250L
        internal const val CALL_POLL_MS = 1000L
        internal const val STARTUP_TIMEOUT_MESSAGE = "Codex voice did not respond in time. Retry when ready."
        fun beginNew(context: Context) = ContextCompat.startForegroundService(context, Intent(context, LiveVoiceService::class.java).setAction(BEGIN_NEW))
        fun begin(context: Context, thread: String) {
            if (NativeCallCooldownStore.remainingMs(context, thread) > 0) {
                state.value = LiveVoiceState(detail = "Lumen is finishing its previous call", taskId = thread)
                return
            }
            ContextCompat.startForegroundService(context, Intent(context, LiveVoiceService::class.java).setAction(BEGIN).putExtra("thread", thread))
        }
        fun end(context: Context) { context.startService(Intent(context, LiveVoiceService::class.java).setAction(END)) }
        fun mute(context: Context) { context.startService(Intent(context, LiveVoiceService::class.java).setAction(MUTE)) }
    }
}
