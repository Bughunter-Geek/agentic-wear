package io.github.sirbughunter.agenticwear

import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.wear.compose.foundation.LocalAmbientModeManager
import androidx.wear.compose.foundation.rememberAmbientModeManager
import io.github.sirbughunter.agenticwear.model.*
import io.github.sirbughunter.agenticwear.ui.*

/** Debug-only synthetic UI fixture. No repository, microphone, pairing or Send transport. */
class ReviewQaActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scenario = intent.getStringExtra("scenario") ?: "normal"
        if (scenario.startsWith("submission-store-")) {
            val result = SubmissionPersistenceQa.run(this, scenario.removePrefix("submission-store-"))
            setContentView(android.widget.TextView(this).apply { text = result; gravity = android.view.Gravity.CENTER; setTextColor(android.graphics.Color.WHITE); setBackgroundColor(android.graphics.Color.BLACK) })
            return
        }
        if (scenario.startsWith("live-")) {
            startActivity(Intent(this, io.github.sirbughunter.agenticwear.live.LiveVoiceActivity::class.java)
                .putExtra(MainActivity.EXTRA_DEMO_STATE, scenario))
            finish()
            return
        }
        if (scenario.startsWith("alert-")) {
            setContent {
                AgenticWearTheme {
                    var request by remember { mutableStateOf(AgentAlert("qa-permission", AlertKind.PERMISSION, "qa-task",
                        "Voice with Codex", "Read the test folder for this turn?", 1, "qa-only", scenario != "alert-resolved")) }
                    AlertScreen(request, readOnly = scenario != "alert-active", approvalMode = ApprovalMode.ALLOW_CONTROLS,
                        pending = false, onBack = { finish() },
                        onApprove = { request = request.copy(canControl = false, detail = "Demo approved locally · nothing sent") },
                        onDecline = { request = request.copy(canControl = false, detail = "Demo declined locally · nothing sent") }, onOpenChat = {})
                }
            }
            return
        }
        if (scenario.startsWith("sessions-")) {
            val discoveryFixture = if (scenario == "sessions-pagination") {
                val rows = (0 until 573).map { AgentSession("qa-page-$it", "Local task $it", it.toLong(),
                    when (it) { 572 -> SessionStatus.ERROR; 100 -> SessionStatus.ACTIVE; else -> SessionStatus.IDLE },
                    false, true, pinned = it in setOf(572, 379)) }
                val original = listOf(rows[572], rows[379]) + rows.filterNot { it.pinned }
                // Wire statuses are lowercase; persisted enum names are uppercase.
                val wireRows = org.json.JSONArray(io.github.sirbughunter.agenticwear.data.PayloadCodec.sessionsToJson(original))
                repeat(wireRows.length()) { index ->
                    wireRows.getJSONObject(index).put("status", original[index].status.name.lowercase())
                }
                val decoded = io.github.sirbughunter.agenticwear.data.PayloadCodec.decodeSessions(org.json.JSONObject()
                    .put("version", 1).put("kind", "sessions.snapshot")
                    .put("sessions", wireRows))
                val restored = io.github.sirbughunter.agenticwear.data.PayloadCodec.sessionsFromJson(
                    io.github.sirbughunter.agenticwear.data.PayloadCodec.sessionsToJson(decoded))
                check(restored.map { it.id } == original.map { it.id })
                check(restored.map { it.status } == original.map { it.status })
                check(restored.map { it.id }.distinct().size == 573)
                val oversized = org.json.JSONArray().apply {
                    repeat(2_005) { put(org.json.JSONObject().put("id", "qa-limit-$it").put("title", "Limit task $it")) }
                }
                val bounded = io.github.sirbughunter.agenticwear.data.PayloadCodec.decodeSessions(org.json.JSONObject()
                    .put("version", 1).put("kind", "sessions.snapshot").put("sessions", oversized))
                check(bounded.size == 2_000)
                check(io.github.sirbughunter.agenticwear.data.PayloadCodec.sessionsFromJson(
                    io.github.sirbughunter.agenticwear.data.PayloadCodec.sessionsToJson(bounded + rows)).size == 2_000)
                android.util.Log.i("AgenticPaginationQa", "decoded=573 restored=573 unique=573 boundedDecode=2000 boundedPersist=2000 selected=qa-page-572 pinOrder=qa-page-572,qa-page-379")
                restored
            } else null
            setContent {
                AgenticWearTheme {
                    var openedEvent by remember { mutableStateOf<AgentAlert?>(null) }
                    if (openedEvent != null) {
                        AlertScreen(openedEvent, readOnly = true, approvalMode = ApprovalMode.ALLOW_CONTROLS,
                            pending = false, onBack = { openedEvent = null }, onApprove = {}, onDecline = {}, onOpenChat = {})
                    } else SessionsScreen(WearUiState(sessions = discoveryFixture ?: listOf(
                        AgentSession("qa-active", "Inspect watch connection", 1, SessionStatus.ACTIVE, false, true, pinned = true),
                        AgentSession("qa-idle", "Voice with Codex", 1, SessionStatus.IDLE, false, true),
                        AgentSession("qa-run", "Quota reset check", 1, SessionStatus.NOT_LOADED, false, false, source = "automation"),
                    ), selectedThreadId = discoveryFixture?.first()?.id, localInventoryComplete = discoveryFixture?.let { true }),
                        onBack = { finish() }, onSelect = {}, initialGroup = if (discoveryFixture != null) "All" else scenario.removePrefix("sessions-").replaceFirstChar { it.uppercase() },
                        activity = listOf(AgentAlert("qa-event", AlertKind.COMPLETE, "qa-idle", "Voice with Codex", "The agent finished its full response.", 1),
                            AgentAlert("qa-permission", AlertKind.PERMISSION, "qa-active", "Permission history", "A previous request to read the test folder.", 2, "qa-only", true)),
                        onOpenActivity = { openedEvent = it })
                }
            }
            return
        }
        val text = when (scenario) {
            "empty" -> ""
            "long" -> List(12) { "Yesterday I bought green flowers. Do not change the meeting time of nine thirty." }.joinToString(" ")
            else -> "Yesterday I bought green flowers."
        }
        setContent {
            val ambient = rememberAmbientModeManager()
            CompositionLocalProvider(LocalAmbientModeManager provides ambient) {
                AgenticWearTheme {
                    var state by remember { mutableStateOf(WearUiState(
                        transcript = Transcript("qa-$scenario", text, null,
                            rawText = "So yesterday I bought red flowers. No, wait, green flowers.",
                            undoText = "Yesterday I bought blue flowers.",
                            editChoices = if (scenario == "ambiguous") listOf("Change the first flower.", "Change the second flower.") else emptyList()),
                        selectedThreadId = if (scenario == "cloud-model") "qa-cloud" else null,
                        sessions = if (scenario == "cloud-model") listOf(AgentSession(
                            "qa-cloud", "Cloud model fixture", 1, SessionStatus.IDLE, false, true,
                            source = "cloud", cloud = CloudModelInfo("GPT-6.1 Sol", listOf("GPT-6.1 Sol", "GPT-6 Astra"),
                                0, "Light", listOf("Light", "Medium", "High", "Extra High", "Max")))) else emptyList(),
                        transcriptionEngine = TranscriptionEngine.BRIDGE_PHONON,
                        transcriptionElapsedMillis = 4200,
                    )) }
                    Box(Modifier.fillMaxSize().background(Ink)) {
                        TranscriptScreen(state,
                            onBack = { finish() },
                            onTextChanged = { value -> state = state.copy(transcript = state.transcript?.editedDraft(value)) },
                            onSend = { state = state.copy(error = "QA only: nothing sent") },
                            onRevise = { state = state.copy(error = "QA only: voice edit cancelled; draft retained") },
                            onOriginal = { state = state.copy(transcript = state.transcript?.let { it.editedDraft(it.rawText.orEmpty()) }) },
                            onUndo = { state = state.copy(transcript = state.transcript?.undoDraft()) },
                            onRetry = { state = state.copy(error = "QA only: no recording replayed") },
                            onModel = {}, onEffort = {}, onApprovalMode = {},
                            onCloudModel = { id, name -> state = state.copy(cloudChoiceThreadId = id, cloudModelChoice = name) },
                            onCloudEffort = { id, index -> state = state.copy(cloudChoiceThreadId = id, cloudEffortChoice = index) },
                            onRefreshSessions = {}, onStartNewSession = {},
                        )
                    }
                }
            }
        }
    }
}
