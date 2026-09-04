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
import io.github.sirbughunter.agenticwear.model.FollowUpAction
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class WearScreen { HOME, PAIR, SESSIONS, TRANSCRIPT, REPLY, CHAT, ALERT, SETTINGS }

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
    val showSendModeOverlay: Boolean = false,
    val showErrorDetails: Boolean = false,
    val replyingFromChat: Boolean = false,
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
    private var voiceAttemptGeneration = 0L
    private var recordingTimeoutJob: Job? = null
    private var transcriptionTimerJob: Job? = null
    private var chatStreamJob: Job? = null
    private var updateCheckJob: Job? = null
    private var updateCheckGeneration = 0L
    private var lastUpdateCheckStartedAtElapsedRealtime = 0L
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
        if (_state.value.demo) return
        if (repository.isPaired) refreshInbox()
        if (updateManager.enabled &&
            SystemClock.elapsedRealtime() - lastUpdateCheckStartedAtElapsedRealtime >= UPDATE_REFRESH_INTERVAL_MS
        ) {
            checkForUpdate(silent = true)
        }
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

    fun openSession(threadId: String) {
        preferences.selectedThreadId = threadId
        preferences.chatSnapshot = null
        openChat(threadId)
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
            val attemptGeneration = ++voiceAttemptGeneration
            deviceSpeech?.destroy()
            val controller = DeviceSpeechController(
                getApplication(),
                onResult = { text ->
                    if (attemptGeneration == voiceAttemptGeneration) {
                        acceptDeviceTranscript(text)
                    }
                },
                onFailure = { message ->
                    if (attemptGeneration == voiceAttemptGeneration) showError(message)
                },
                onVoiceLevel = { level ->
                    if (attemptGeneration == voiceAttemptGeneration) updateVoiceLevel(level)
                },
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
        cancelVoiceRequest(returnHome = false)
    }

    fun cancelVoiceRequest() = cancelVoiceRequest(returnHome = true)

    private fun cancelVoiceRequest(returnHome: Boolean) {
        val current = _state.value
        val voiceSession = VoiceSessionService.sessionState.value
        val active = current.recording || current.transcribing ||
            voiceSession.phase == VoiceSessionPhase.RECORDING ||
            voiceSession.phase == VoiceSessionPhase.TRANSCRIBING
        if (!active) return
        if (current.demo) {
            cancelTranscriptionTimerJob()
            _state.update {
                it.copy(
                    pending = false,
                    recording = false,
                    transcribing = false,
                    transcriptionElapsedMillis = null,
                    voiceLevel = 0f,
                    error = null,
                )
            }
            return
        }
        voiceAttemptGeneration += 1
        stopVoiceMonitoring()
        cancelTranscriptionTimerJob()
        repository.cancelTranscription(voiceSession.transcriptionRequestId)
        if (_state.value.transcriptionEngine == TranscriptionEngine.BRIDGE_WHISPER) {
            VoiceSessionService.cancel(getApplication())
        } else {
            deviceSpeech?.cancel()
        }
        val restoredTranscript = preferences.transcript
        _state.update {
            it.copy(
                screen = when {
                    restoredTranscript != null -> WearScreen.TRANSCRIPT
                    returnHome -> WearScreen.HOME
                    else -> it.screen
                },
                transcript = restoredTranscript,
                pending = false,
                recording = false,
                transcribing = false,
                transcriptionElapsedMillis = null,
                voiceLevel = 0f,
                error = null,
            )
        }
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

    fun submitTranscript(followUpAction: FollowUpAction = FollowUpAction.DEFAULT) {
        val transcript = _state.value.transcript ?: return
        val current = _state.value
        val draftText = transcript.text
        val targetThreadId = threadIdForDraftSubmission(current)
        if (targetThreadId != null) {
            preferences.selectedThreadId = targetThreadId
        }
        _state.update { it.copy(screen = WearScreen.CHAT, pending = true, error = null) }
        launchTask(showPending = false) {
            val threadId = repository.submitTurn(
                threadId = targetThreadId,
                text = draftText,
                model = current.selectedModel,
                effort = current.reasoningEffort,
                followUpAction = followUpAction,
            )
            preferences.selectedThreadId = threadId
            preferences.submitDraftAsNewSession = false
            reload(WearScreen.CHAT)
            startChatStream(threadId)
            repository.watchChat(threadId)
            reload(WearScreen.CHAT)
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
        val returnToChat = _state.value.replyingFromChat
        val threadId = _state.value.transcript?.threadId
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
        _state.update { current ->
            resetForNewTranscription(current).copy(
                screen = if (returnToChat) WearScreen.CHAT else WearScreen.HOME,
                replyingFromChat = false,
            )
        }
        if (returnToChat && threadId != null) startChatStream(threadId)
    }

    fun retryChat() {
        val threadId = _state.value.selectedSession?.id
            ?: _state.value.chat?.threadId
            ?: preferences.selectedThreadId
            ?: return
        openChat(threadId)
    }

    fun replyFromChat() {
        _state.update { it.copy(screen = WearScreen.REPLY, error = null) }
    }

    fun cancelReplyFromChat() {
        _state.update { it.copy(screen = WearScreen.CHAT, error = null) }
    }

    fun replyWithVoiceFromChat() {
        stopChatStream()
        _state.update { it.copy(screen = WearScreen.HOME, error = null) }
    }

    fun replyWithTextFromChat() {
        val threadId = _state.value.chat?.threadId
            ?: _state.value.selectedSession?.id
            ?: preferences.selectedThreadId
            ?: return showError("Choose a Codex session first")
        stopChatStream()
        val draft = Transcript(UUID.randomUUID().toString(), "", threadId)
        preferences.selectedThreadId = threadId
        preferences.transcript = draft
        preferences.revisionBase = null
        preferences.pending = false
        preferences.lastError = null
        _state.update { prepareTextReply(it, draft) }
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
            UpdateStage.CHECKING -> checkForUpdate(silent = false, force = true)
            UpdateStage.DOWNLOADING -> Unit
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
        updateCheckGeneration += 1
        updateCheckJob?.cancel()
        updateManager.cancelActiveChecks()
        val now = System.currentTimeMillis()
        val sessions = listOf(
            AgentSession("demo-build", "Build Agentic Wear Alpha 0.4", now, SessionStatus.ACTIVE, true, true),
            AgentSession("demo-qa", "Review watch interface", now - 318_000, SessionStatus.NOT_LOADED, false, false),
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
        val homeUpdateDemo = normalized == "home-update"
        val homeUpdateDownloadingDemo = normalized == "home-update-downloading"
        val homeUpdateReadyDemo = normalized == "home-update-ready"
        val homeErrorDemo = normalized == "home-error"
        val chatDemo = normalized in setOf("chat", "chat-idle", "chat-roles", "chat-error", "chat-permission", "sync-error")
        val alert = when (normalized) {
            "home-alert" -> AgentAlert("demo-home-alert", AlertKind.COMPLETE, "demo-build", sessions[0].title, "The latest Watch prompt completed successfully.", now)
            "approval" -> AgentAlert("demo-approval", AlertKind.PERMISSION, "demo-build", sessions[0].title, "Allow Gradle to access the network?", now, "demo-approval-id", true)
            "complete" -> AgentAlert("demo-complete", AlertKind.COMPLETE, "demo-build", sessions[0].title, "All checks passed. Release APK is ready for review.", now)
            "error" -> AgentAlert("demo-error", AlertKind.ERROR, "demo-docs", sessions[2].title, "The agent stopped after a build error.", now)
            else -> null
        }
        val transcript = if (normalized in setOf("transcript", "text-reply", "transcript-foreign-error", "send-mode")) {
            Transcript(
                "demo-transcript",
                if (normalized == "text-reply") "" else "Make the completion state calmer and verify the release build.",
                "demo-build",
            )
        } else null
        _state.value = WearUiState(
            screen = when (normalized) {
                "pair" -> WearScreen.PAIR
                "sessions" -> WearScreen.SESSIONS
                "transcript", "text-reply", "transcript-foreign-error", "send-mode" -> WearScreen.TRANSCRIPT
                "reply" -> WearScreen.REPLY
                "chat", "chat-idle", "chat-roles", "chat-error", "chat-permission", "sync-error" -> WearScreen.CHAT
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
            chat = if (chatDemo && normalized != "sync-error") {
                io.github.sirbughunter.agenticwear.model.ChatSnapshot(
                    threadId = "demo-build",
                    title = sessions[0].title,
                    status = if (normalized in setOf("chat-idle", "chat-roles")) SessionStatus.IDLE else SessionStatus.ACTIVE,
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
                    messages = if (normalized == "chat-roles") {
                        listOf(
                            ChatMessage(
                                id = "demo-role-user",
                                turnId = "demo-role-turn",
                                role = ChatRole.USER,
                                text = "Make chat roles unmistakable.",
                                phase = io.github.sirbughunter.agenticwear.model.ChatPhase.UNKNOWN,
                            ),
                            ChatMessage(
                                id = "demo-role-agent",
                                turnId = "demo-role-turn",
                                role = ChatRole.ASSISTANT,
                                text = "Done — user and agent messages are distinct at a glance.",
                                phase = io.github.sirbughunter.agenticwear.model.ChatPhase.FINAL_ANSWER,
                            ),
                        )
                    } else if (normalized == "chat-idle") {
                        listOf(
                            ChatMessage(
                                id = "demo-chat-idle",
                                turnId = "demo-turn-idle",
                                role = ChatRole.ASSISTANT,
                                text = "The latest response is ready to read.",
                                phase = io.github.sirbughunter.agenticwear.model.ChatPhase.FINAL_ANSWER,
                            ),
                        )
                    } else listOf(
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
            appUpdate = when {
                updatePermissionDemo -> UpdateUiState(
                    enabled = true,
                    stage = UpdateStage.READY,
                    release = AppRelease(8, "0.1.7", "https://example.com/agentic-wear.apk", "0".repeat(64), null),
                    progress = 100,
                    message = "One-time permission needed",
                )
                homeUpdateDemo -> UpdateUiState(
                    enabled = true,
                    stage = UpdateStage.AVAILABLE,
                    release = AppRelease(32, "0.6.6", "https://example.com/agentic-wear.apk", "0".repeat(64), null),
                )
                homeUpdateDownloadingDemo -> UpdateUiState(
                    enabled = true,
                    stage = UpdateStage.DOWNLOADING,
                    release = AppRelease(32, "0.6.6", "https://example.com/agentic-wear.apk", "0".repeat(64), null),
                    progress = 64,
                )
                homeUpdateReadyDemo -> UpdateUiState(
                    enabled = true,
                    stage = UpdateStage.READY,
                    release = AppRelease(32, "0.6.6", "https://example.com/agentic-wear.apk", "0".repeat(64), null),
                    progress = 100,
                    message = "Ready to install",
                )
                else -> UpdateUiState(enabled = updateManager.enabled)
            },
            showInstallPermissionPrompt = updatePermissionDemo,
            showSendModeOverlay = normalized == "send-mode",
            showErrorDetails = normalized in setOf("sync-error", "error-detail", "error-details"),
            replyingFromChat = normalized == "text-reply",
            error = when {
                homeErrorDemo -> "I didn't catch enough audio. Tap and try again."
                normalized in setOf("sync-error", "error-detail", "error-details") -> "Codex could not synchronize this session after retrying. Agentic Wear did not queue or send your message, and your draft remains on the watch. Refresh sessions and retry."
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

    private fun checkForUpdate(silent: Boolean, force: Boolean = false) {
        if (!updateManager.enabled || _state.value.appUpdate.stage == UpdateStage.DOWNLOADING) return
        if (updateCheckJob?.isActive == true) {
            if (!force) return
            updateCheckGeneration += 1
            updateCheckJob?.cancel()
            updateManager.cancelActiveChecks()
        }
        val generation = ++updateCheckGeneration
        val cached = updateManager.cachedRelease()
        if (!silent || cached == null) {
            _state.update { current ->
                current.copy(appUpdate = current.appUpdate.copy(stage = UpdateStage.CHECKING, progress = 0, message = null))
            }
        } else {
            _state.update { current ->
                current.copy(appUpdate = UpdateUiState(enabled = true, stage = UpdateStage.AVAILABLE, release = cached))
            }
        }
        lastUpdateCheckStartedAtElapsedRealtime = SystemClock.elapsedRealtime()
        updateCheckJob = viewModelScope.launch(Dispatchers.IO) {
            runCatching(updateManager::checkForUpdate)
                .onSuccess { release ->
                    if (generation != updateCheckGeneration) return@onSuccess
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
                    if (generation != updateCheckGeneration) return@onFailure
                    val verified = updateManager.cachedRelease()
                    _state.update { current ->
                        val update = when {
                            verified != null -> UpdateUiState(
                                enabled = true,
                                stage = UpdateStage.AVAILABLE,
                                release = verified,
                                message = "Showing the last verified update",
                            )
                            silent -> UpdateUiState(enabled = true)
                            else -> current.appUpdate.copy(
                                stage = UpdateStage.ERROR,
                                message = updateErrorMessage(error),
                            )
                        }
                        current.copy(appUpdate = update)
                    }
                }
            if (generation == updateCheckGeneration) updateCheckJob = null
        }
    }

    private fun openChat(threadId: String) {
        stopChatStream(sendUnwatch = false)
        _state.update { current -> current.copy(screen = WearScreen.CHAT, pending = true, error = null) }
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val snapshot = repository.watchChat(threadId)
                    ?: preferences.chatSnapshot?.takeIf { it.threadId == threadId }
                if (snapshot == null) {
                    showError("The bridge did not return this chat. Keep Codex running, then tap Retry.")
                } else {
                    reload(WearScreen.CHAT)
                    startChatStream(threadId)
                }
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (error: Throwable) {
                showError(error)
            } finally {
                _state.update { current -> current.copy(pending = false) }
            }
        }
    }

    private fun startChatStream(threadId: String) {
        chatStreamJob?.cancel()
        chatStreamJob = viewModelScope.launch(Dispatchers.IO) {
            var ticks = 0
            while (isActive && _state.value.screen == WearScreen.CHAT) {
                delay(CHAT_POLL_INTERVAL_MS)
                try {
                    repository.refreshChatInbox()
                } catch (cancellation: CancellationException) {
                    throw cancellation
                } catch (error: Throwable) {
                    _state.update { current ->
                        current.copy(error = error.message ?: "Live chat refresh failed")
                    }
                }
                ticks += 1
                val refreshTicks = if (_state.value.chat?.status == SessionStatus.ACTIVE) {
                    CHAT_ACTIVE_REFRESH_TICKS
                } else {
                    CHAT_IDLE_REFRESH_TICKS
                }
                if (ticks >= refreshTicks) {
                    ticks = 0
                    try {
                        repository.requestChatRefresh(threadId)
                    } catch (cancellation: CancellationException) {
                        throw cancellation
                    } catch (_: Throwable) {
                    }
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

    private fun showError(error: Throwable) {
        if (error is CancellationException) return
        showError(error.message ?: "Something went wrong")
    }

    private fun showError(message: String) {
        if (message.contains("was cancelled", ignoreCase = true) ||
            message.contains("CancellationException", ignoreCase = true)
        ) {
            return
        }
        voiceAttemptGeneration += 1
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
            try {
                block()
                if (showPending) _state.update { it.copy(pending = false) }
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (error: Throwable) {
                showError(error)
            }
        }
    }

    private fun reload(screen: WearScreen? = null) {
        if (_state.value.demo) return
        val current = _state.value
        val effectiveScreen = screen ?: if (current.screen == WearScreen.TRANSCRIPT && preferences.transcript == null) {
            WearScreen.CHAT
        } else {
            current.screen
        }
        val restored = readState(effectiveScreen)
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
            appUpdate = updateManager.cachedRelease()?.let { release ->
                UpdateUiState(enabled = true, stage = UpdateStage.AVAILABLE, release = release)
            } ?: UpdateUiState(enabled = updateManager.enabled),
        )
    }

    override fun onCleared() {
        stopVoiceMonitoring()
        cancelTranscriptionTimerJob()
        updateCheckGeneration += 1
        updateCheckJob?.cancel()
        updateManager.cancelActiveChecks()
        deviceSpeech?.destroy()
        stopChatStream()
        getApplication<Application>().unregisterReceiver(stateReceiver)
        super.onCleared()
    }

    companion object {
        private const val TRANSCRIPTION_TIMER_INTERVAL_MS = 100L
        private const val UPDATE_REFRESH_INTERVAL_MS = 15L * 60L * 1_000L
        private const val MAX_RECORDING_DURATION_MS = 4L * 60L * 1_000L
        private const val CHAT_POLL_INTERVAL_MS = 1_000L
        private const val CHAT_ACTIVE_REFRESH_TICKS = 2
        private const val CHAT_IDLE_REFRESH_TICKS = 15
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

internal fun prepareTextReply(current: WearUiState, draft: Transcript): WearUiState = current.copy(
    screen = WearScreen.TRANSCRIPT,
    selectedThreadId = draft.threadId,
    transcript = draft,
    pending = false,
    error = null,
    replyingFromChat = true,
)
