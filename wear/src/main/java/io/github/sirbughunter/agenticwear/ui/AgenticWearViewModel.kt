package io.github.sirbughunter.agenticwear.ui

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
import io.github.sirbughunter.agenticwear.model.SessionStatus
import io.github.sirbughunter.agenticwear.model.Transcript
import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import io.github.sirbughunter.agenticwear.update.AppRelease
import io.github.sirbughunter.agenticwear.update.AppUpdateManager
import io.github.sirbughunter.agenticwear.update.UpdateStage
import io.github.sirbughunter.agenticwear.update.UpdateUiState
import io.github.sirbughunter.agenticwear.voice.DeviceSpeechController
import io.github.sirbughunter.agenticwear.voice.VoiceRecorder
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class WearScreen { HOME, PAIR, SESSIONS, TRANSCRIPT, ALERT, SETTINGS }

data class WearUiState(
    val screen: WearScreen = WearScreen.HOME,
    val isPaired: Boolean = false,
    val sessions: List<AgentSession> = emptyList(),
    val selectedThreadId: String? = null,
    val latestAlert: AgentAlert? = null,
    val transcript: Transcript? = null,
    val pending: Boolean = false,
    val recording: Boolean = false,
    val error: String? = null,
    val transcriptionEngine: TranscriptionEngine = TranscriptionEngine.BRIDGE_WHISPER,
    val approvalMode: ApprovalMode = ApprovalMode.ALERT_ONLY,
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
    private val recorder = VoiceRecorder(application)
    private val updateManager = AppUpdateManager(application)
    private val _state = MutableStateFlow(readState())
    val state: StateFlow<WearUiState> = _state.asStateFlow()
    private var deviceSpeech: DeviceSpeechController? = null
    private var downloadedUpdate: File? = null
    private var awaitingInstallPermission = false

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
        if (repository.isPaired) refreshInbox()
        if (updateManager.enabled) checkForUpdate(silent = true)
    }

    fun navigate(screen: WearScreen) {
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
        repository.refreshInboxAndSessions(notify = true)
        reload()
    }

    fun selectSession(threadId: String) {
        preferences.selectedThreadId = threadId
        reload(WearScreen.HOME)
    }

    fun setTranscriptionEngine(engine: TranscriptionEngine) {
        preferences.transcriptionEngine = engine
        reload()
    }

    fun setApprovalMode(mode: ApprovalMode) {
        preferences.approvalMode = mode
        reload()
    }

    fun beginPushToTalk() {
        if (_state.value.recording || _state.value.pending) return
        _state.update { it.copy(recording = true, error = null) }
        if (_state.value.transcriptionEngine == TranscriptionEngine.BRIDGE_WHISPER) {
            runCatching { recorder.start() }.onFailure(::showError)
        } else {
            val controller = deviceSpeech ?: DeviceSpeechController(
                getApplication(),
                onResult = ::acceptDeviceTranscript,
                onFailure = ::showError,
            ).also { deviceSpeech = it }
            runCatching { controller.start() }.onFailure(::showError)
        }
    }

    fun endPushToTalk() {
        if (!_state.value.recording) return
        _state.update { it.copy(recording = false) }
        if (_state.value.transcriptionEngine == TranscriptionEngine.BRIDGE_WHISPER) {
            val audio = recorder.stop()
            if (audio == null) showError("Hold a little longer so I can hear you") else transcribe(audio)
        } else {
            deviceSpeech?.stop()
        }
    }

    fun updateTranscript(text: String) {
        val transcript = _state.value.transcript ?: return
        _state.update { it.copy(transcript = transcript.copy(text = text.take(4_000))) }
    }

    fun submitTranscript() {
        val transcript = _state.value.transcript ?: return
        launchTask {
            repository.submitTurn(transcript.threadId ?: _state.value.selectedSession?.id, transcript.text)
            reload(WearScreen.HOME)
        }
    }

    fun retryTranscript() {
        _state.update { it.copy(screen = WearScreen.HOME, transcript = null, error = null) }
    }

    fun respondToApproval(approve: Boolean) {
        val approvalId = _state.value.latestAlert?.approvalId ?: return
        launchTask {
            repository.respondToApproval(approvalId, approve)
            reload(WearScreen.HOME)
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
        repository.disconnect()
        reload(WearScreen.PAIR)
    }

    fun showDemo(stateName: String?) {
        if (!BuildConfig.DEBUG || stateName.isNullOrBlank()) return
        val now = System.currentTimeMillis()
        val sessions = listOf(
            AgentSession("demo-build", "Build Agentic Wear v0.1", now, SessionStatus.ACTIVE, true, true),
            AgentSession("demo-qa", "Review watch interface", now - 318_000, SessionStatus.IDLE, false, true),
            AgentSession("demo-docs", "Prepare open-source launch", now - 1_460_000, SessionStatus.ERROR, false, false),
        )
        val normalized = stateName.lowercase()
        val updatePermissionDemo = normalized == "update-permission"
        val homeErrorDemo = normalized == "home-error"
        val alert = when (normalized) {
            "approval" -> AgentAlert("demo-approval", AlertKind.PERMISSION, "demo-build", sessions[0].title, "Allow Gradle to access the network?", now, "demo-approval-id", true)
            "complete" -> AgentAlert("demo-complete", AlertKind.COMPLETE, "demo-build", sessions[0].title, "All checks passed. Release APK is ready for review.", now)
            "error" -> AgentAlert("demo-error", AlertKind.ERROR, "demo-docs", sessions[2].title, "The agent stopped after a build error.", now)
            else -> null
        }
        val transcript = if (normalized == "transcript") {
            Transcript("demo-transcript", "Make the completion state calmer and verify the release build.", "demo-build")
        } else null
        _state.value = WearUiState(
            screen = when (normalized) {
                "pair" -> WearScreen.PAIR
                "sessions" -> WearScreen.SESSIONS
                "transcript" -> WearScreen.TRANSCRIPT
                "approval", "complete", "error" -> WearScreen.ALERT
                "settings", "update-permission" -> WearScreen.SETTINGS
                else -> WearScreen.HOME
            },
            isPaired = normalized != "pair",
            sessions = sessions,
            selectedThreadId = "demo-build",
            latestAlert = alert,
            transcript = transcript,
            approvalMode = if (normalized == "approval") ApprovalMode.ALLOW_CONTROLS else ApprovalMode.ALERT_ONLY,
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
            error = if (homeErrorDemo) "Hold a little longer so I can hear you" else null,
            demo = true,
        )
    }

    private fun acceptDeviceTranscript(text: String) {
        val transcript = Transcript(UUID.randomUUID().toString(), text, _state.value.selectedSession?.id)
        _state.update { it.copy(recording = false, transcript = transcript, screen = WearScreen.TRANSCRIPT) }
    }

    private fun transcribe(file: File) = launchTask {
        repository.transcribe(file, _state.value.selectedSession?.id)
        reload(WearScreen.HOME)
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
        (error.message ?: "Could not prepare the update").take(120)

    private fun showError(error: Throwable) = showError(error.message ?: "Something went wrong")

    private fun showError(message: String) {
        recorder.cancel()
        _state.update { it.copy(recording = false, pending = false, error = message.take(180)) }
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
        _state.value = readState(screen ?: current.screen).copy(
            appUpdate = current.appUpdate,
            showInstallPermissionPrompt = current.showInstallPermissionPrompt,
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
            selectedThreadId = preferences.selectedThreadId,
            latestAlert = preferences.latestAlert,
            transcript = transcript,
            pending = preferences.pending,
            error = preferences.lastError,
            transcriptionEngine = preferences.transcriptionEngine,
            approvalMode = preferences.approvalMode,
            relayUrl = preferences.relayUrl,
            appUpdate = UpdateUiState(enabled = updateManager.enabled),
        )
    }

    override fun onCleared() {
        recorder.cancel()
        deviceSpeech?.destroy()
        getApplication<Application>().unregisterReceiver(stateReceiver)
        super.onCleared()
    }
}
