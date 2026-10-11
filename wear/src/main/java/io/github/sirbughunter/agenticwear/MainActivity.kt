package io.github.sirbughunter.agenticwear

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.CompositionLocalProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.wear.compose.foundation.LocalAmbientModeManager
import androidx.wear.compose.foundation.rememberAmbientModeManager
import io.github.sirbughunter.agenticwear.model.PendingQuestionReply
import io.github.sirbughunter.agenticwear.ui.AgenticWearApp
import io.github.sirbughunter.agenticwear.live.LiveVoiceActivity
import io.github.sirbughunter.agenticwear.ui.AgenticWearTheme
import io.github.sirbughunter.agenticwear.ui.AgenticWearViewModel
import io.github.sirbughunter.agenticwear.ui.extractPairingCode
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val viewModel by viewModels<AgenticWearViewModel>()
    private var pairingCodePrefill by mutableStateOf("")
    private var requestingMicrophonePermission = false
    private val microphonePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        requestingMicrophonePermission = false
        if (granted) viewModel.beginPushToTalk() else viewModel.cancelPreparedEdit()
    }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (openLiveVoiceDemo(intent)) { finish(); return }
        handleIntent(intent)
        setContent {
            val ambientModeManager = rememberAmbientModeManager()
            CompositionLocalProvider(LocalAmbientModeManager provides ambientModeManager) {
                AgenticWearTheme {
                    AgenticWearApp(
                        viewModel = viewModel,
                        onPushToTalk = ::togglePushToTalk,
                        pairingCodePrefill = pairingCodePrefill,
                    )
                }
            }
        }
        observeActiveVoiceSession()
        requestNotificationPermission()
    }

    override fun onStart() {
        super.onStart()
        io.github.sirbughunter.agenticwear.notification.AppForeground.isForeground = true
        viewModel.onForegrounded()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (openLiveVoiceDemo(intent)) return
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        viewModel.resumePendingInstallAfterPermission()
    }

    override fun onStop() {
        if (!isChangingConfigurations && !requestingMicrophonePermission) viewModel.onActivityStopped()
        super.onStop()
        io.github.sirbughunter.agenticwear.notification.AppForeground.isForeground = false
    }

    override fun onDestroy() {
        setKeepScreenOn(false)
        super.onDestroy()
    }

    private fun observeActiveVoiceSession() {
        lifecycleScope.launch {
            viewModel.state
                .map { state ->
                    keepScreenOnForVoiceSession(
                        recording = state.recording,
                        transcribing = state.transcribing,
                        transcriptionElapsedMillis = state.transcriptionElapsedMillis,
                    ) || state.appUpdate.stage == io.github.sirbughunter.agenticwear.update.UpdateStage.DOWNLOADING
                }
                .distinctUntilChanged()
                .collect(::setKeepScreenOn)
        }
    }

    private fun setKeepScreenOn(enabled: Boolean) {
        val flag = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        if (enabled) window.addFlags(flag) else window.clearFlags(flag)
    }

    private fun togglePushToTalk() {
        if (io.github.sirbughunter.agenticwear.live.LiveVoiceService.state.value.phase in setOf("creating", "connecting", "live", "reconnecting")) {
            startActivity(Intent(this, io.github.sirbughunter.agenticwear.live.LiveVoiceActivity::class.java))
            return
        }
        if (viewModel.state.value.recording) {
            viewModel.endPushToTalk()
            return
        }
        if (viewModel.state.value.pending) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            viewModel.beginPushToTalk()
        } else {
            requestingMicrophonePermission = true
            microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    private fun openLiveVoiceDemo(source: Intent?): Boolean {
        val demo = source?.getStringExtra(EXTRA_DEMO_STATE)
        if (!BuildConfig.DEBUG || demo !in LiveVoiceActivity.DEMO_STATES) return false
        startActivity(Intent(this, LiveVoiceActivity::class.java)
            .putExtra(EXTRA_DEMO_STATE, demo)
            .putExtra(LiveVoiceActivity.EXTRA_DEMO_COLOUR, source?.getStringExtra(LiveVoiceActivity.EXTRA_DEMO_COLOUR)))
        return true
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun handleIntent(intent: Intent?) {
        viewModel.showDemo(intent?.getStringExtra(EXTRA_DEMO_STATE))
        intent?.getStringExtra(EXTRA_PAIRING_CODE)?.let { value ->
            extractPairingCode(value)?.let { pairingCodePrefill = it }
        }
        if (handleQuestionIntent(intent)) return
        if (intent?.hasExtra(EXTRA_THREAD_ID) == true) {
            intent.getStringExtra(EXTRA_THREAD_ID)?.let { threadId ->
                viewModel.openSession(threadId)
            }
        } else if (intent?.hasExtra(EXTRA_ALERT_EVENT_ID) == true) {
            viewModel.openAlert(intent.getStringExtra(EXTRA_ALERT_EVENT_ID), intent.getBooleanExtra(EXTRA_ALERT_READ_ONLY, false))
        }
    }

    /**
     * Only the "Reply" action lands here, and it sends nothing. MainActivity is exported, so it never
     * sends an answer from intent extras; option answers go through [QuestionActionActivity].
     */
    private fun handleQuestionIntent(intent: Intent?): Boolean {
        val source = intent ?: return false
        val reply = parseQuestionReplyIntent(
            source.getStringExtra(EXTRA_THREAD_ID),
            source.getStringExtra(EXTRA_QUESTION_ITEM_ID),
            source.getBooleanExtra(EXTRA_QUESTION_REPLY, false),
            source.getIntExtra(EXTRA_QUESTION_INDEX, 0),
            source.getStringExtra(EXTRA_QUESTION_TEXT).orEmpty(),
        ) ?: return false
        // Consume once: the intent is replayed when the activity is recreated.
        listOf(EXTRA_QUESTION_REPLY, EXTRA_QUESTION_ITEM_ID, EXTRA_QUESTION_INDEX, EXTRA_QUESTION_TEXT, EXTRA_QUESTION_ANSWER)
            .forEach(source::removeExtra)
        viewModel.replyToQuestion(reply)
        return true
    }

    companion object {
        const val EXTRA_QUESTION_ITEM_ID = "io.github.sirbughunter.agenticwear.QUESTION_ITEM_ID"
        const val EXTRA_QUESTION_INDEX = "io.github.sirbughunter.agenticwear.QUESTION_INDEX"
        const val EXTRA_QUESTION_ANSWER = "io.github.sirbughunter.agenticwear.QUESTION_ANSWER"
        const val EXTRA_QUESTION_TEXT = "io.github.sirbughunter.agenticwear.QUESTION_TEXT"
        const val EXTRA_QUESTION_REPLY = "io.github.sirbughunter.agenticwear.QUESTION_REPLY"
        const val EXTRA_DEMO_STATE = "io.github.sirbughunter.agenticwear.DEMO_STATE"
        const val EXTRA_ALERT_EVENT_ID = "io.github.sirbughunter.agenticwear.ALERT_EVENT_ID"
        const val EXTRA_ALERT_READ_ONLY = "io.github.sirbughunter.agenticwear.ALERT_READ_ONLY"
        const val EXTRA_PAIRING_CODE = "io.github.sirbughunter.agenticwear.PAIRING_CODE"
        const val EXTRA_THREAD_ID = "io.github.sirbughunter.agenticwear.THREAD_ID"
    }
}

internal const val TRANSCRIBING_SCREEN_AWAKE_LIMIT_MS = 30_000L

internal fun keepScreenOnForVoiceSession(
    recording: Boolean,
    transcribing: Boolean,
    transcriptionElapsedMillis: Long?,
): Boolean = recording || (
    transcribing && (transcriptionElapsedMillis ?: 0L) < TRANSCRIBING_SCREEN_AWAKE_LIMIT_MS
)

/** Pure: opens the reply input only for an explicit reply request; any answer extra is ignored. */
internal fun parseQuestionReplyIntent(
    threadId: String?,
    itemId: String?,
    reply: Boolean,
    index: Int,
    question: String,
): PendingQuestionReply? {
    if (!reply || threadId.isNullOrBlank() || itemId.isNullOrBlank()) return null
    return PendingQuestionReply(threadId, itemId, index.coerceIn(0, 9), question.take(1_000))
}
