package io.github.sirbughunter.agenticwear

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import io.github.sirbughunter.agenticwear.ui.AgenticWearApp
import io.github.sirbughunter.agenticwear.ui.AgenticWearTheme
import io.github.sirbughunter.agenticwear.ui.AgenticWearViewModel
import io.github.sirbughunter.agenticwear.ui.extractPairingCode

class MainActivity : ComponentActivity() {
    private val viewModel by viewModels<AgenticWearViewModel>()
    private var pairingCodePrefill by mutableStateOf("")
    private var pushToTalkHeld = false
    private val microphonePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted && pushToTalkHeld) viewModel.beginPushToTalk()
    }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
        setContent {
            AgenticWearTheme {
                AgenticWearApp(
                    viewModel = viewModel,
                    onPushToTalkStart = ::startPushToTalk,
                    onPushToTalkEnd = ::endPushToTalk,
                    pairingCodePrefill = pairingCodePrefill,
                )
            }
        }
        requestNotificationPermission()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        viewModel.resumePendingInstall()
    }

    private fun startPushToTalk() {
        pushToTalkHeld = true
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            viewModel.beginPushToTalk()
        } else {
            microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    private fun endPushToTalk() {
        pushToTalkHeld = false
        viewModel.endPushToTalk()
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
