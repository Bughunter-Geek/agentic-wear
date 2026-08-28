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
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import io.github.sirbughunter.agenticwear.ui.AgenticWearApp
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
        if (granted) viewModel.beginPushToTalk()
    }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        setContent {
            AgenticWearTheme {
                AgenticWearApp(
                    viewModel = viewModel,
                    onPushToTalk = ::togglePushToTalk,
                    pairingCodePrefill = pairingCodePrefill,
                )
            }
        }
        observeActiveVoiceSession()
        requestNotificationPermission()
    }

    override fun onStart() {
        super.onStart()
        viewModel.onForegrounded()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        viewModel.resumePendingInstallAfterPermission()
    }

    override fun onStop() {
        if (!isChangingConfigurations && !requestingMicrophonePermission) viewModel.cancelRecording()
        super.onStop()
    }

    override fun onDestroy() {
        setKeepScreenOn(false)
        super.onDestroy()
    }

    private fun observeActiveVoiceSession() {
        lifecycleScope.launch {
            viewModel.state
                .map { state -> keepScreenOnForVoiceSession(state.recording, state.transcribing) }
                .distinctUntilChanged()
                .collect(::setKeepScreenOn)
        }
    }

    private fun setKeepScreenOn(enabled: Boolean) {
        val flag = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        if (enabled) window.addFlags(flag) else window.clearFlags(flag)
    }

    private fun togglePushToTalk() {
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
        if (intent?.hasExtra(EXTRA_ALERT_EVENT_ID) == true) {
            viewModel.openAlert(intent.getStringExtra(EXTRA_ALERT_EVENT_ID))
        }
    }

    companion object {
        const val EXTRA_DEMO_STATE = "io.github.sirbughunter.agenticwear.DEMO_STATE"
        const val EXTRA_ALERT_EVENT_ID = "io.github.sirbughunter.agenticwear.ALERT_EVENT_ID"
        const val EXTRA_PAIRING_CODE = "io.github.sirbughunter.agenticwear.PAIRING_CODE"
    }
}

internal fun keepScreenOnForVoiceSession(recording: Boolean, transcribing: Boolean): Boolean =
    recording || transcribing
