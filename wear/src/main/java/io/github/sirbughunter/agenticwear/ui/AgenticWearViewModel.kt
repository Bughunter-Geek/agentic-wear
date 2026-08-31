package io.github.sirbughunter.agenticwear.ui

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.sirbughunter.agenticwear.BuildConfig
import io.github.sirbughunter.agenticwear.data.AgenticWearRepository
import io.github.sirbughunter.agenticwear.data.AppPreferences
import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AgentSession
import io.github.sirbughunter.agenticwear.model.AlertKind
import io.github.sirbughunter.agenticwear.model.ApprovalMode
import io.github.sirbughunter.agenticwear.model.ChatSnapshot
import io.github.sirbughunter.agenticwear.model.ChatMessage
import io.github.sirbughunter.agenticwear.model.ChatRole
import io.github.sirbughunter.agenticwear.model.FeedbackRating
import io.github.sirbughunter.agenticwear.model.MAX_TRANSCRIPT_CHARS
import io.github.sirbughunter.agenticwear.model.ModelOption
import io.github.sirbughunter.agenticwear.model.ReasoningEffortPolicy
import io.github.sirbughunter.agenticwear.model.SessionStatus
import io.github.sirbughunter.agenticwear.model.Transcript
import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import io.github.sirbughunter.agenticwear.update.AppRelease
import io.github.sirbughunter.agenticwear.update.AppUpdateManager
import io.github.sirbughunter.agenticwear.update.UpdateStage
import io.github.sirbughunter.agenticwear.update.UpdateUiState
import io.github.sirbughunter.agenticwear.voice.DeviceSpeechController
import io.github.sirbughunter.agenticwear.voice.VoiceSessionPhase
import io.github.sirbughunter.agenticwear.voice.VoiceSessionService
import io.github.sirbughunter.agenticwear.voice.VoiceSessionSnapshot
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class WearScreen { HOME, PAIR, SESSIONS, TRANSCRIPT, CHAT, ALERT, SETTINGS }

data class WearUiState(
    val screen: WearScreen = WearScreen.HOME,
    val isPaired: Boolean = false,
    val sessions: List<AgentSession> = emptyList(),
    val models: List<ModelOption> = emptyList(),
    val selectedThreadId: String? = null,
    val submitDraftAsNewSession: Boolean = false,
    val latestAlert: AgentAlert? = null,
    val transcript: Transcript? = null,
    val chat: ChatSnapshot? = null,
    val chatFeedback: Map<String, FeedbackRating> = emptyMap(),
    val feedbackPendingMessageId: String? = null,
    val pending: Boolean = false,
    val recording: Boolean = false,
    val transcribing: Boolean = false,
    val transcriptionElapsedMillis: Long? = null,
    val voiceLevel: Float = 0f,
    val error: String? = null,
    val sendNotice: String? = null,
    val transcriptionEngine: TranscriptionEngine = TranscriptionEngine.BRIDGE_WHISPER,
    val approvalMode: ApprovalMode = ApprovalMode.ALERT_ONLY,
    val collapseUpdates: Boolean = true,
    val selectedModel: String? = null,
    val reasoningEffort: String = ReasoningEffortPolicy.DEFAULT,
    val relayUrl: String = "",
    val appUpdate: UpdateUiState = UpdateUiState(),
    val showInstallPermissionPrompt: Boolean = false,
    val demo: Boolean = false,
) {
    val selectedSession: AgentSession?
        get() = sessions.firstOrNull { it.id == selectedThreadId } ?: sessions.firstOrNull()
}

class AgenticWearViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = AgenticWearRepository(application)
    private val preferences = AppPreferences(application)
    private val updateManager = AppUpdateManager(application)
    private val _state = MutableStateFlow(readState())
    val state: StateFlow<WearUiState> = _state.asStateFlow()
    private var deviceSpeech: DeviceSpeechController? = null
    private var recordingTimeoutJob: Job? = null
    private var transcriptionTimerJob: Job? = null
    private var chatStreamJob: Job? = null
    @Volatile
    private var transcriptionStartedAtElapsedRealtime: Long? = null
    @Volatile
    private var frozenTranscriptionElapsedMillis: Long? = null
    private var downloadedUpdate: File? = null
    private var awaitingInstallPermission = false
    private var foregroundStartedAtMillis = System.currentTimeMillis()

    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) = reload()
    }

    init {
        ContextCompat.registerReceiver(
            application,
            stateReceiver,
            IntentFilter(AgenticWearRepository.ACTION_STATE_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        viewModelScope.launch {
            VoiceSessionService.sessionState.collect(::applyVoiceSessionState)
        }
        if (updateManager.enabled) checkForUpdate(silent = true)
    }

    fun onForegrounded() {
        foregroundStartedAtMillis = System.currentTimeMillis()
        if (repository.isPaired) refreshInbox()
    }

    fun navigate(screen: WearScreen) {
        if (_state.value.screen == WearScreen.CHAT && screen != WearScreen.CHAT) stopChatStream()
        if (screen != WearScreen.HOME) cancelRecording()
        _state.update { current ->
            current.copy(
                screen = if (!current.isPaired && screen != WearScreen.PAIR) WearScreen.PAIR else screen,
                error = null,
            )
        }
    }

    fun openAlert(eventId: String?) {
        val alert = eventId?.let(preferences::alert) ?: preferences.latestAlert
        _state.update { current -> current.copy(screen = WearScreen.ALERT, latestAlert = alert, error = null) }
    }

    fun pair(code: String, relayUrl: String) = launchTask {
        repository.pair(code, relayUrl)
        reload(WearScreen.HOME)
    }

    fun refreshInbox() = launchTask(showPending = false) {
        repository.refreshInboxAndSessions(notify = true, notifyAfterMillis = foregroundStartedAtMillis)
        reload()
    }

    fun refreshSessionsForRecovery() = refreshInbox()

    /** Keeps the recorded draft and requires an explicit Send before creating a new thread. */
    fun startNewSessionForRecovery() {
        val current = _state.value
        val recovered = recoverDraftForNewSession(current)
        if (recovered === current) return
        preferences.selectedThreadId = null
        preferences.chatSnapshot = null
        preferences.transcript = recovered.transcript
        preferences.submitDraftAsNewSession = true
        _state.value = recovered
    }

    fun selectSession(threadId: String) {
        preferences.selectedThreadId = threadId
        preferences.chatSnapshot = null
        reload(WearScreen.HOME)
    }

    fun openSelectedChat() {
        val threadId = _state.value.selectedSession?.id ?: return showError("Choose a Codex session first")
        openChat(threadId)
    }

    fun setTranscriptionEngine(engine: TranscriptionEngine) {
        preferences.transcriptionEngine = engine
        reload()
    }

    fun setApprovalMode(mode: ApprovalMode) {
        preferences.approvalMode = mode
        _state.update { current -> current.copy(approvalMode = mode) }
    }

    fun setCollapseUpdates(enabled: Boolean) {
        preferences.collapseUpdates = enabled
        _state.update { current -> current.copy(collapseUpdates = enabled) }
    }

    fun setModel(model: String?) {
        val selected = model?.trim()?.takeIf { it.isNotEmpty() }
        val modelOption = _state.value.models.firstOrNull { it.model == selected }
        val defaultEffort = ReasoningEffortPolicy.defaultFor(modelOption)
        preferences.selectedModel = selected
        preferences.reasoningEffort = defaultEffort
        _state.update { current ->
            current.copy(selectedModel = selected, reasoningEffort = defaultEffort)
        }
    }

    fun setReasoningEffort(effort: String) {
        val modelOption = _state.value.models.firstOrNull { it.model == _state.value.selectedModel }
        val normalized = ReasoningEffortPolicy.normalize(effort)
        if (normalized in ReasoningEffortPolicy.options(modelOption)) {
            preferences.reasoningEffort = normalized
            _state.update { current -> current.copy(reasoningEffort = normalized) }
        }
    }

    fun beginPushToTalk() {
        if (_state.value.recording || _state.value.pending) return
        cancelTranscriptionTimerJob()
        if (_state.value.transcriptionEngine == TranscriptionEngine.BRIDGE_WHISPER) {
            runCatching {
                VoiceSessionService.begin(
                    context = getApplication(),
                    threadId = _state.value.selectedSession?.id,
                    notifyAfterMillis = foregroundStartedAtMillis,
                )
            }
                .onSuccess {
                    _state.update { current ->
                        current.copy(
                            recording = true,
                            transcribing = false,
                            transcriptionElapsedMillis = null,
                            voiceLevel = 0f,
                            error = null,
                        )
                    }
                }
                .onFailure(::showError)
        } else {
            val controller = deviceSpeech ?: DeviceSpeechController(
                getApplication(),
                onResult = ::acceptDeviceTranscript,
                onFailure = ::showError,
                onVoiceLevel = ::updateVoiceLevel,
            ).also { deviceSpeech = it }
            runCatching { controller.start() }
                .onSuccess {
                    _state.update { current ->
                        current.copy(
                            recording = true,
                            transcribing = false,
                            transcriptionElapsedMillis = null,
                            voiceLevel = 0f,
                            error = null,
                        )
                    }
                    startRecordingTimeout()
                }
                .onFailure(::showError)
        }
    }

    fun endPushToTalk() = finishPushToTalk(measureLatency = true)

    private fun finishPushToTalk(measureLatency: Boolean) {
        if (!_state.value.recording) return
        if (measureLatency) startTranscriptionTimer()
        _state.update { it.copy(recording = false, voiceLevel = 0f) }
        if (_state.value.transcriptionEngine == TranscriptionEngine.BRIDGE_WHISPER) {
            _state.update { it.copy(pending = true, transcribing = true) }
            VoiceSessionService.finish(getApplication())
        } else {
            _state.update { it.copy(pending = true, transcribing = true) }
            deviceSpeech?.stop()
        }
    }

    fun cancelRecording() {
        if (!_state.value.recording && VoiceSessionService.sessionState.value.phase != VoiceSessionPhase.RECORDING) return
        if (_state.value.transcriptionEngine == TranscriptionEngine.BRIDGE_WHISPER) {
            VoiceSessionService.cancel(getApplication())
        } else {
            stopVoiceMonitoring()
            deviceSpeech?.cancel()
        }
        _state.update { it.copy(recording = false, transcribing = false, voiceLevel = 0f) }
    }

    fun onActivityStopped() {
        if (shouldCancelRecordingWhenActivityStops(_state.value.transcriptionEngine)) cancelRecording()
    }

    fun updateTranscript(text: String) {
        val transcript = _state.value.transcript ?: return
        val updated = transcript.copy(text = text.take(MAX_TRANSCRIPT_CHARS))
        preferences.transcript = updated
        _state.update { it.copy(transcript = updated) }
    }

    fun submitTranscript() {
        val transcript = _state.value.transcript ?: return
        launchTask {
            val current = _state.value
            val threadId = repository.submitTurn(
                threadId = threadIdForDraftSubmission(current),
                text = transcript.text,
                model = current.selectedModel,
                effort = current.reasoningEffort,
            )
            preferences.selectedThreadId = threadId
            preferences.submitDraftAsNewSession = false
            repository.watchChat(threadId)
            reload(WearScreen.CHAT)
            startChatStream(threadId)
        }
    }

    fun reviseTranscript() {
        val transcript = _state.value.transcript ?: return
        if (_state.value.transcriptionEngine != TranscriptionEngine.BRIDGE_WHISPER) {
            discardTranscript()
            return
        }
        stopVoiceMonitoring()
        cancelTranscriptionTimerJob()
        preferences.revisionBase = transcript
        preferences.transcript = null
        preferences.pending = false
        preferences.lastError = null
        _state.update(::resetForNewTranscription)
    }

    fun discardTranscript() {
        stopVoiceMonitoring()
        cancelTranscriptionTimerJob()
        recordingTimeoutJob?.cancel()
        VoiceSessionService.cancel(getApplication())
        deviceSpeech?.cancel()
        preferences.transcript = null
        preferences.revisionBase = null
        preferences.submitDraftAsNewSession = false
        preferences.pending = false
        preferences.lastError = null
        _state.update(::resetForNewTranscription)
    }

    fun retryChat() {
        val threadId = _state.value.selectedSession?.id ?: return
        openChat(threadId)
    }

    fun replyFromChat() {
        stopChatStream()
        _state.update { it.copy(screen = WearScreen.HOME, error = null) }
    }

    fun respondToApproval(approve: Boolean) {
        val approvalId = _state.value.latestAlert?.approvalId ?: return
        launchTask {
            repository.respondToApproval(approvalId, approve)
            reload(WearScreen.HOME)
        }
    }

    fun respondToChatPermission(message: ChatMessage, approve: Boolean) {
        val approvalId = message.approvalId ?: return
        if (message.resolved || !message.canControl) return
        launchTask {
            repository.respondToApproval(approvalId, approve)
            reload(WearScreen.CHAT)
        }
    }

    fun rateChatMessage(message: ChatMessage, rating: FeedbackRating) {
        val current = _state.value
        val chat = current.chat ?: return
        if (message.role != ChatRole.ASSISTANT ||
            current.feedbackPendingMessageId != null ||
            current.chatFeedback[message.id] == rating
        ) return
        _state.update { state -> state.copy(feedbackPendingMessageId = message.id, error = null) }
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                repository.submitFeedback(chat.threadId, message.turnId, message.id, rating)
            }.onSuccess {
                _state.update { state ->
                    state.copy(
                        chatFeedback = preferences.chatFeedback,
                        feedbackPendingMessageId = null,
                    )
                }
            }.onFailure { error ->
                _state.update { state ->
                    state.copy(
                        feedbackPendingMessageId = null,
                        error = error.message ?: "Could not send feedback",
                    )
                }
            }
        }
    }

    fun onUpdateAction() {
        when (_state.value.appUpdate.stage) {
            UpdateStage.IDLE, UpdateStage.CURRENT, UpdateStage.ERROR -> checkForUpdate(silent = false)
            UpdateStage.AVAILABLE -> _state.value.appUpdate.release?.let(::downloadUpdate)
            UpdateStage.READY -> continueInstall()
            UpdateStage.CHECKING, UpdateStage.DOWNLOADING -> Unit
        }
    }

    fun dismissInstallPermissionPrompt() {
        awaitingInstallPermission = false
        _state.update { current -> current.copy(showInstallPermissionPrompt = false) }
    }

    fun continueInstallAfterWarning() {
        _state.update { current -> current.copy(showInstallPermissionPrompt = false) }
        launchDownloadedInstaller()
    }

    fun resumePendingInstallAfterPermission() {
        if (!awaitingInstallPermission || !updateManager.canRequestInstalls()) return
        awaitingInstallPermission = false
        launchDownloadedInstaller()
    }

    fun disconnect() {
        cancelRecording()
        cancelTranscriptionTimerJob()
        _state.update { current ->
            current.copy(
                pending = false,
                recording = false,
                transcribing = false,
                transcriptionElapsedMillis = null,
                voiceLevel = 0f,
            )
        }
        repository.disconnect()
        reload(WearScreen.PAIR)
    }

    fun showDemo(stateName: String?) {
        if (!BuildConfig.DEBUG || stateName.isNullOrBlank()) return
        cancelTranscriptionTimerJob()
        val now = System.currentTimeMillis()
        val sessions = listOf(
            AgentSession("demo-build", "Build Agentic Wear Alpha 0.4", now, SessionStatus.ACTIVE, true, true),
            AgentSession("demo-qa", "Review watch interface", now - 318_000, SessionStatus.IDLE, false, true),
            AgentSession("demo-docs", "Prepare open-source launch", now - 1_460_000, SessionStatus.ERROR, false, false),
        )
        val models = listOf(
            ModelOption(
                id = "gpt-5.6-sol",
                displayName = "GPT-5.6-Sol",
                model = "gpt-5.6-sol",
                defaultReasoningEffort = "low",
                supportedReasoningEfforts = listOf("low", "medium", "high", "xhigh", "max", "ultra"),
            ),
            ModelOption(
                id = "gpt-5.6-terra",
                displayName = "GPT-5.6-Terra",
                model = "gpt-5.6-terra",
                defaultReasoningEffort = "medium",
                supportedReasoningEfforts = ReasoningEffortPolicy.FALLBACK_OPTIONS,
            ),
        )
        val normalized = stateName.lowercase()
        val updatePermissionDemo = normalized == "update-permission"
        val homeErrorDemo = normalized == "home-error"
        val chatDemo = normalized in setOf("chat", "chat-error", "chat-permission")
        val alert = when (normalized) {
            "approval" -> AgentAlert("demo-approval", AlertKind.PERMISSION, "demo-build", sessions[0].title, "Allow Gradle to access the network?", now, "demo-approval-id", true)
            "complete" -> AgentAlert("demo-complete", AlertKind.COMPLETE, "demo-build", sessions[0].title, "All checks passed. Release APK is ready for review.", now)
            "error" -> AgentAlert("demo-error", AlertKind.ERROR, "demo-docs", sessions[2].title, "The agent stopped after a build error.", now)
            else -> null
        }
        val transcript = if (normalized == "transcript" || normalized == "transcript-foreign-error") {
            Transcript("demo-transcript", "Make the completion state calmer and verify the release build.", "demo-build")
        } else null
        _state.value = WearUiState(
            screen = when (normalized) {
                "pair" -> WearScreen.PAIR
                "sessions" -> WearScreen.SESSIONS
                "transcript", "transcript-foreign-error" -> WearScreen.TRANSCRIPT
                "chat", "chat-error", "chat-permission" -> WearScreen.CHAT
                "approval", "complete", "error" -> WearScreen.ALERT
                "settings", "update-permission" -> WearScreen.SETTINGS
                else -> WearScreen.HOME
            },
            isPaired = normalized != "pair",
            sessions = sessions,
            models = models,
            selectedThreadId = "demo-build",
            latestAlert = alert,
            transcript = transcript,
            chat = if (chatDemo) {
                io.github.sirbughunter.agenticwear.model.ChatSnapshot(
                    threadId = "demo-build",
                    title = sessions[0].title,
                    status = SessionStatus.ACTIVE,
                    paragraphs = listOf(
                        io.github.sirbughunter.agenticwear.model.ChatParagraph(
                            "demo-chat-1",
                            "I’ve isolated the delivery race and am validating the repaired bridge handshake now.",
                            io.github.sirbughunter.agenticwear.model.ChatPhase.COMMENTARY,
                        ),
                        io.github.sirbughunter.agenticwear.model.ChatParagraph(
                            "demo-chat-2",
                            "The prompt is accepted and the draft remains recoverable.",
                            io.github.sirbughunter.agenticwear.model.ChatPhase.FINAL_ANSWER,
                        ),
                    ),
                    generatedAtMillis = now,
                    messages = listOf(
                        ChatMessage(
                            id = "demo-user-1",
                            turnId = "demo-turn-1",
                            role = ChatRole.USER,
                            text = "Please **ship this carefully** and keep my message visible on the watch.",
                            phase = io.github.sirbughunter.agenticwear.model.ChatPhase.UNKNOWN,
                        ),
                        ChatMessage(
                            id = "demo-chat-1",
                            turnId = "demo-turn-1",
                            role = ChatRole.ASSISTANT,
                            text = "I’ve isolated the delivery race and am validating:\n\n- Model sync\n- Permission handling",
                            phase = io.github.sirbughunter.agenticwear.model.ChatPhase.COMMENTARY,
                        ),
                        ChatMessage(
                            id = "demo-chat-2",
                            turnId = "demo-turn-1",
                            role = ChatRole.ASSISTANT,
                            text = "## Ready for testing\n\nThe prompt is **accepted**, the draft stays recoverable, and `Markdown` renders cleanly.",
                            phase = io.github.sirbughunter.agenticwear.model.ChatPhase.FINAL_ANSWER,
                        ),
                    ) + if (normalized == "chat-permission") {
                        listOf(
                            ChatMessage(
                                id = "demo-permission-1",
                                turnId = "demo-turn-2",
                                role = ChatRole.ASSISTANT,
                                text = "Allow Gradle to access the network, resolve dependencies, and download build metadata for this turn?",
                                phase = io.github.sirbughunter.agenticwear.model.ChatPhase.UNKNOWN,
                                kind = io.github.sirbughunter.agenticwear.model.ChatMessageKind.PERMISSION,
                                approvalId = "demo-permission-1",
                                canControl = true,
                            ),
                        )
                    } else {
                        emptyList()
                    },
                )
            } else null,
            pending = normalized == "home-transcribing",
            recording = normalized == "home-listening" || normalized == "home-speaking",
            transcribing = normalized == "home-transcribing",
            transcriptionElapsedMillis = when (normalized) {
                "home-transcribing" -> 3_400L
                "transcript" -> 5_200L
                else -> null
            },
            voiceLevel = if (normalized == "home-speaking") 0.72f else 0f,
            approvalMode = if (normalized == "approval" || normalized == "chat-permission") {
                ApprovalMode.ALLOW_CONTROLS
            } else {
                ApprovalMode.ALERT_ONLY
            },
            collapseUpdates = preferences.collapseUpdates,
            selectedModel = if (normalized == "transcript") models.first().model else null,
            reasoningEffort = if (normalized == "transcript") "high" else ReasoningEffortPolicy.DEFAULT,
            relayUrl = "https://relay.example.workers.dev",
            appUpdate = if (updatePermissionDemo) {
                UpdateUiState(
                    enabled = true,
                    stage = UpdateStage.READY,
                    release = AppRelease(8, "0.1.7", "https://example.com/agentic-wear.apk", "0".repeat(64), null),
                    progress = 100,
                    message = "One-time permission needed",
                )
            } else {
                UpdateUiState(enabled = updateManager.enabled)
            },
            showInstallPermissionPrompt = updatePermissionDemo,
            error = when {
                homeErrorDemo -> "I didn't catch enough audio. Tap and try again."
                normalized == "chat-error" -> "The bridge could not load this session after resyncing. Agentic Wear kept your selection. Refresh sessions and retry; choose another chat only if this one no longer appears."
                normalized == "transcript-foreign-error" -> "Codex still owns this session in another client. Agentic Wear did not queue or send your prompt; the complete draft remains on this watch. Refresh sessions to re-check ownership, then retry only after the other client finishes. If it remains busy, choose Start new; your draft will stay on this watch and nothing is created or sent until you explicitly tap Send."
                else -> null
            },
            demo = true,
        )
    }

    private fun acceptDeviceTranscript(text: String) {
        stopVoiceMonitoring()
        val elapsedMillis = freezeTranscriptionTimer()
        val transcript = Transcript(UUID.randomUUID().toString(), text, _state.value.selectedSession?.id)
        preferences.revisionBase = null
        preferences.transcript = transcript
        preferences.pending = false
        preferences.lastError = null
        _state.update {
            it.copy(
                recording = false,
                pending = false,
                transcribing = false,
                transcriptionElapsedMillis = elapsedMillis ?: it.transcriptionElapsedMillis,
                voiceLevel = 0f,
                transcript = transcript,
                screen = WearScreen.TRANSCRIPT,
            )
        }
    }

    private fun startRecordingTimeout() {
        recordingTimeoutJob?.cancel()
        recordingTimeoutJob = viewModelScope.launch {
            delay(MAX_RECORDING_DURATION_MS)
            if (_state.value.recording) finishPushToTalk(measureLatency = false)
        }
    }

    @Synchronized
    private fun startTranscriptionTimer(startedAt: Long = SystemClock.elapsedRealtime()) {
        cancelTranscriptionTimerJob()
        transcriptionStartedAtElapsedRealtime = startedAt
        _state.update { current -> current.copy(transcriptionElapsedMillis = 0L) }
        transcriptionTimerJob = viewModelScope.launch {
            while (isActive && transcriptionStartedAtElapsedRealtime == startedAt) {
                delay(TRANSCRIPTION_TIMER_INTERVAL_MS)
                if (transcriptionStartedAtElapsedRealtime != startedAt) break
                val elapsedMillis = elapsedRealtimeDelta(startedAt, SystemClock.elapsedRealtime())
                _state.update { current ->
                    if (current.transcriptionElapsedMillis == elapsedMillis) {
                        current
                    } else {
                        current.copy(transcriptionElapsedMillis = elapsedMillis)
                    }
                }
            }
        }
    }

    @Synchronized
    private fun freezeTranscriptionTimer(): Long? {
        frozenTranscriptionElapsedMillis?.let { return it }
        val startedAt = transcriptionStartedAtElapsedRealtime ?: return null
        val elapsedMillis = elapsedRealtimeDelta(startedAt, SystemClock.elapsedRealtime())
        frozenTranscriptionElapsedMillis = elapsedMillis
        cancelTranscriptionTimerJob(clearFrozenElapsed = false)
        return elapsedMillis
    }

    @Synchronized
    private fun cancelTranscriptionTimerJob(clearFrozenElapsed: Boolean = true) {
        transcriptionStartedAtElapsedRealtime = null
        transcriptionTimerJob?.cancel()
        transcriptionTimerJob = null
        if (clearFrozenElapsed) frozenTranscriptionElapsedMillis = null
    }

    private fun stopVoiceMonitoring() {
        recordingTimeoutJob?.cancel()
        recordingTimeoutJob = null
    }

    private fun applyVoiceSessionState(session: VoiceSessionSnapshot) {
        when (session.phase) {
            VoiceSessionPhase.RECORDING -> _state.update { current ->
                current.copy(
                    recording = true,
                    transcribing = false,
                    voiceLevel = session.voiceLevel,
                    error = null,
                )
            }
            VoiceSessionPhase.TRANSCRIBING -> {
                val startedAt = session.transcriptionStartedAtElapsedRealtime
                if (startedAt != null && transcriptionStartedAtElapsedRealtime != startedAt) {
                    startTranscriptionTimer(startedAt)
                }
                _state.update { current ->
                    current.copy(recording = false, pending = true, transcribing = true, voiceLevel = 0f, error = null)
                }
            }
            VoiceSessionPhase.ERROR -> {
                cancelTranscriptionTimerJob()
                _state.update { current ->
                    current.copy(
                        recording = false,
                        pending = false,
                        transcribing = false,
                        transcriptionElapsedMillis = null,
                        voiceLevel = 0f,
                        error = session.error ?: "Voice recording stopped unexpectedly",
                    )
                }
            }
            VoiceSessionPhase.IDLE -> _state.update { current ->
                current.copy(recording = false, voiceLevel = 0f)
            }
        }
    }

    private fun updateVoiceLevel(level: Float) {
        _state.update { current ->
            if (current.recording) current.copy(voiceLevel = level.coerceIn(0f, 1f)) else current
        }
    }

    private fun checkForUpdate(silent: Boolean) {
        if (!updateManager.enabled || _state.value.appUpdate.stage in setOf(UpdateStage.CHECKING, UpdateStage.DOWNLOADING)) return
        _state.update { current ->
            current.copy(appUpdate = current.appUpdate.copy(stage = UpdateStage.CHECKING, progress = 0, message = null))
        }
        viewModelScope.launch(Dispatchers.IO) {
            runCatching(updateManager::checkForUpdate)
                .onSuccess { release ->
                    _state.update { current ->
                        current.copy(
                            appUpdate = UpdateUiState(
                                enabled = true,
                                stage = if (release == null) UpdateStage.CURRENT else UpdateStage.AVAILABLE,
                                release = release,
                                message = if (release == null) "Agentic Wear is up to date" else null,
                            ),
                        )
                    }
                }
                .onFailure { error ->
                    _state.update { current ->
                        current.copy(
                            appUpdate = if (silent) {
                                UpdateUiState(enabled = true)
                            } else {
                                current.appUpdate.copy(
                                    stage = UpdateStage.ERROR,
                                    message = updateErrorMessage(error),
                                )
                            },
                        )
                    }
                }
        }
    }

    private fun openChat(threadId: String) {
        stopChatStream(sendUnwatch = false)
        _state.update { current -> current.copy(screen = WearScreen.CHAT, pending = true, error = null) }
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { repository.watchChat(threadId) }
                .onSuccess { snapshot ->
                    if (snapshot == null) {
                        showError("The bridge did not return this chat. Keep Codex running, then tap Retry.")
                    } else {
                        reload(WearScreen.CHAT)
                        startChatStream(threadId)
                    }
                }
                .onFailure(::showError)
            _state.update { current -> current.copy(pending = false) }
        }
    }

    private fun startChatStream(threadId: String) {
        chatStreamJob?.cancel()
        chatStreamJob = viewModelScope.launch(Dispatchers.IO) {
            var ticks = 0
            while (isActive && _state.value.screen == WearScreen.CHAT) {
                delay(CHAT_POLL_INTERVAL_MS)
                runCatching { repository.refreshChatInbox() }
                    .onFailure { error ->
                        _state.update { current ->
                            current.copy(error = error.message ?: "Live chat refresh failed")
                        }
                    }
                ticks += 1
                if (ticks >= CHAT_WATCH_HEARTBEAT_TICKS) {
                    ticks = 0
                    runCatching { repository.watchChat(threadId) }
                }
            }
        }
    }

    private fun stopChatStream(sendUnwatch: Boolean = true) {
        chatStreamJob?.cancel()
        chatStreamJob = null
        val threadId = _state.value.chat?.threadId ?: _state.value.selectedSession?.id
        if (sendUnwatch && threadId != null && repository.isPaired) {
            viewModelScope.launch(Dispatchers.IO) { runCatching { repository.unwatchChat(threadId) } }
        }
    }

    private fun downloadUpdate(release: AppRelease) {
        _state.update { current ->
            current.copy(appUpdate = current.appUpdate.copy(stage = UpdateStage.DOWNLOADING, progress = 0, message = null))
        }
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                updateManager.download(release) { progress ->
                    _state.update { current ->
                        current.copy(appUpdate = current.appUpdate.copy(progress = progress))
                    }
                }
            }.onSuccess { apk ->
                downloadedUpdate = apk
                _state.update { current ->
                    current.copy(appUpdate = current.appUpdate.copy(stage = UpdateStage.READY, progress = 100, message = "Ready to install"))
                }
                viewModelScope.launch(Dispatchers.Main) { continueInstall() }
            }.onFailure { error ->
                _state.update { current ->
                    current.copy(
                        appUpdate = current.appUpdate.copy(
                            stage = UpdateStage.ERROR,
                            message = updateErrorMessage(error),
                        ),
                    )
                }
            }
        }
    }

    private fun continueInstall() {
        val apk = downloadedUpdate
        if (apk == null || !apk.isFile) {
            _state.update { current ->
                current.copy(appUpdate = current.appUpdate.copy(stage = UpdateStage.ERROR, message = "Download the update again"))
            }
            return
        }
        if (!updateManager.canRequestInstalls()) {
            _state.update { current ->
                current.copy(
                    showInstallPermissionPrompt = true,
                    appUpdate = current.appUpdate.copy(message = "One-time permission needed"),
                )
            }
            return
        }
        launchDownloadedInstaller()
    }

    private fun launchDownloadedInstaller() {
        val apk = downloadedUpdate
        if (apk == null || !apk.isFile) {
            _state.update { current ->
                current.copy(appUpdate = current.appUpdate.copy(stage = UpdateStage.ERROR, message = "Download the update again"))
            }
            return
        }
        val canRequestInstalls = updateManager.canRequestInstalls()
        awaitingInstallPermission = !canRequestInstalls
        if (updateManager.launchInstaller(apk)) {
            _state.update { current ->
                current.copy(
                    appUpdate = current.appUpdate.copy(
                        message = if (canRequestInstalls) {
                            "Confirm the update on the system screen"
                        } else {
                            "Allow Agentic Wear in Settings; the installer will resume automatically"
                        },
                    ),
                )
            }
        } else {
            awaitingInstallPermission = false
            _state.update { current ->
                current.copy(appUpdate = current.appUpdate.copy(stage = UpdateStage.ERROR, message = "System installer is unavailable"))
            }
        }
    }

    private fun updateErrorMessage(error: Throwable): String =
        error.message ?: "Could not prepare the update"

    private fun showError(error: Throwable) = showError(error.message ?: "Something went wrong")

    private fun showError(message: String) {
        stopVoiceMonitoring()
        cancelTranscriptionTimerJob()
        VoiceSessionService.cancel(getApplication())
        deviceSpeech?.cancel()
        _state.update {
            it.copy(
                recording = false,
                pending = false,
                transcribing = false,
                transcriptionElapsedMillis = null,
                voiceLevel = 0f,
                error = message,
            )
        }
    }

    private fun launchTask(showPending: Boolean = true, block: suspend () -> Unit) {
        if (showPending) _state.update { it.copy(pending = true, error = null) }
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { block() }
                .onFailure(::showError)
                .onSuccess { if (showPending) _state.update { it.copy(pending = false) } }
        }
    }

    private fun reload(screen: WearScreen? = null) {
        if (_state.value.demo) return
        val current = _state.value
        val restored = readState(screen ?: current.screen)
        val transcriptReady = restored.transcript != null
        val transcriptDismissed = current.transcript != null && restored.transcript == null
        val transcriptionFailed = restored.error != null
        val elapsedMillis = when {
            transcriptReady -> freezeTranscriptionTimer() ?: current.transcriptionElapsedMillis
            transcriptDismissed -> {
                cancelTranscriptionTimerJob()
                null
            }
            transcriptionFailed -> {
                cancelTranscriptionTimerJob()
                null
            }
            else -> current.transcriptionElapsedMillis
        }
        _state.value = restored.copy(
            appUpdate = current.appUpdate,
            showInstallPermissionPrompt = current.showInstallPermissionPrompt,
            feedbackPendingMessageId = current.feedbackPendingMessageId,
            recording = current.recording && !transcriptReady,
            transcribing = current.transcribing && !transcriptReady && !transcriptionFailed,
            transcriptionElapsedMillis = elapsedMillis,
            voiceLevel = if (transcriptReady || transcriptionFailed) 0f else current.voiceLevel,
        )
    }

    private fun readState(screen: WearScreen? = null): WearUiState {
        val paired = repository.isPaired
        val transcript = preferences.transcript
        val destination = when {
            !paired -> WearScreen.PAIR
            transcript != null -> WearScreen.TRANSCRIPT
            else -> screen ?: WearScreen.HOME
        }
        return WearUiState(
            screen = destination,
            isPaired = paired,
            sessions = preferences.sessions,
            models = preferences.models,
            selectedThreadId = preferences.selectedThreadId,
            submitDraftAsNewSession = preferences.submitDraftAsNewSession,
            latestAlert = preferences.latestAlert,
            transcript = transcript,
            chat = preferences.chatSnapshot,
            chatFeedback = preferences.chatFeedback,
            pending = preferences.pending,
            error = preferences.lastError,
            sendNotice = preferences.lastSendNotice,
            transcriptionEngine = preferences.transcriptionEngine,
            approvalMode = preferences.approvalMode,
            collapseUpdates = preferences.collapseUpdates,
            selectedModel = preferences.selectedModel,
            reasoningEffort = preferences.reasoningEffort,
            relayUrl = preferences.relayUrl,
            appUpdate = UpdateUiState(enabled = updateManager.enabled),
        )
    }

    override fun onCleared() {
        stopVoiceMonitoring()
        cancelTranscriptionTimerJob()
        deviceSpeech?.destroy()
        stopChatStream()
        getApplication<Application>().unregisterReceiver(stateReceiver)
        super.onCleared()
    }

    companion object {
        private const val TRANSCRIPTION_TIMER_INTERVAL_MS = 100L
        private const val MAX_RECORDING_DURATION_MS = 4L * 60L * 1_000L
        private const val CHAT_POLL_INTERVAL_MS = 1_000L
        private const val CHAT_WATCH_HEARTBEAT_TICKS = 45
    }
}

internal fun resetForNewTranscription(current: WearUiState): WearUiState = current.copy(
    screen = WearScreen.HOME,
    transcript = null,
    pending = false,
    recording = false,
    transcribing = false,
    transcriptionElapsedMillis = null,
    voiceLevel = 0f,
    error = null,
    submitDraftAsNewSession = false,
)

internal fun shouldCancelRecordingWhenActivityStops(engine: TranscriptionEngine): Boolean =
    engine == TranscriptionEngine.DEVICE_SPEECH
