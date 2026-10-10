package io.github.sirbughunter.agenticwear.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.Undo
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.NotificationsNone
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.TouchApp
import androidx.compose.material.icons.rounded.ViewList
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.Text
import io.github.sirbughunter.agenticwear.model.ApprovalMode
import io.github.sirbughunter.agenticwear.model.FollowUpAction
import io.github.sirbughunter.agenticwear.model.ModelOption
import io.github.sirbughunter.agenticwear.model.ReasoningEffortPolicy
import io.github.sirbughunter.agenticwear.model.SessionStatus
import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import kotlinx.coroutines.delay

/** Full-screen Wear dialog: scales in, owns Back, and blocks the screen beneath. */
@Composable
internal fun AwDialog(visible: Boolean, onDismiss: () -> Unit, content: @Composable BoxScope.() -> Unit) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(220)) + scaleIn(tween(300, easing = AwEase), initialScale = 1.05f),
        exit = fadeOut(tween(160)) + scaleOut(tween(160), targetScale = 1.03f),
    ) {
        BackHandler(onBack = onDismiss)
        Box(
            Modifier
                .fillMaxSize()
                .background(Aw.Bg)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = {}),
            content = content,
        )
    }
}

@Composable
internal fun TranscriptScreen(
    state: WearUiState,
    onBack: () -> Unit,
    onTextChanged: (String) -> Unit,
    onSend: (FollowUpAction) -> Unit,
    onRevise: () -> Unit,
    onOriginal: () -> Unit,
    onUndo: () -> Unit,
    onRetry: () -> Unit,
    onModel: (String?) -> Unit,
    onEffort: (String) -> Unit,
    onApprovalMode: (ApprovalMode) -> Unit,
    onRefreshSessions: () -> Unit,
    onStartNewSession: () -> Unit,
) {
    val transcript = state.transcript
    LaunchedEffect(transcript?.requestId) {
        if (transcript != null) {
            withFrameNanos { }
            io.github.sirbughunter.agenticwear.voice.VoiceLatency.preview()
        }
    }
    var showOriginal by rememberSaveable(transcript?.requestId) { mutableStateOf(false) }
    var dialog by rememberSaveable(state.showSendModeOverlay) { mutableStateOf(if (state.showSendModeOverlay) "send" else "") }
    val textFocus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(state.replyingFromChat) {
        if (state.replyingFromChat) {
            delay(250)
            runCatching { textFocus.requestFocus() }
            keyboard?.show()
        }
    }
    val actionsEnabled = !state.pending && !state.recording && !state.transcribing
    val selectedModel = state.models.firstOrNull { it.model == state.selectedModel }
    val modelLabel = selectedModel?.displayName ?: state.selectedModel ?: "Auto"
    val effortLabel = ReasoningEffortPolicy.label(state.reasoningEffort)
    val engineLabel = when (state.transcriptionEngine) {
        TranscriptionEngine.BRIDGE_PHONON -> "Phonon"
        TranscriptionEngine.BRIDGE_WHISPER -> "Mac dictation"
        TranscriptionEngine.DEVICE_SPEECH -> "Watch dictation"
    }
    val canSend = actionsEnabled && !transcript?.text.isNullOrBlank() && transcript.editChoices.isEmpty()

    Box(Modifier.fillMaxSize().background(Aw.Bg)) {
        AwScrollColumn(spacing = 0.dp, bottomPadding = 76.dp) {
            Text(
                buildString {
                    append(if (state.replyingFromChat) "Text reply · " else "To ")
                    append(transcriptDestinationLabel(state))
                },
                style = AwType.Caption,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
            )
            Spacer(Modifier.height(7.dp))
            // Composer: the editable draft with an inline voice-edit action.
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(Aw.Surface)
                    .border(1.dp, Aw.SurfaceHigh, RoundedCornerShape(18.dp))
                    .padding(start = 11.dp, end = 9.dp, top = 9.dp, bottom = 8.dp),
            ) {
                Column {
                    BasicTextField(
                        value = transcript?.text.orEmpty(),
                        onValueChange = onTextChanged,
                        textStyle = TextStyle(color = Aw.Text, fontSize = 14.sp, lineHeight = 19.sp),
                        cursorBrush = SolidColor(Aw.Text),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 44.dp, max = 96.dp)
                            .focusRequester(textFocus)
                            .semantics { contentDescription = if (state.replyingFromChat) "Your reply" else "Your message" },
                        decorationBox = { inner ->
                            if (transcript?.text.isNullOrEmpty()) {
                                Text(if (state.replyingFromChat) "Type your reply" else "Your message", color = Aw.TextTertiary, fontSize = 14.sp)
                            }
                            inner()
                        },
                    )
                    if (!state.replyingFromChat) {
                        Spacer(Modifier.height(6.dp))
                        ComposerChip(
                            label = if (state.transcriptionEngine.usesBridge) "Edit by voice" else "Redo",
                            icon = Icons.Rounded.Mic,
                            enabled = actionsEnabled,
                            onClick = onRevise,
                            modifier = Modifier.align(Alignment.End),
                        )
                    }
                }
            }
            if (!state.replyingFromChat) {
                Spacer(Modifier.height(6.dp))
                Text(
                    buildString {
                        append(engineLabel)
                        state.transcriptionElapsedMillis?.let { append(" · ").append(formatTranscriptionElapsed(it)) }
                    },
                    style = AwType.Micro,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().semantics {
                        state.transcriptionElapsedMillis?.let { contentDescription = "Transcribed with $engineLabel in ${formatTranscriptionElapsed(it)}" }
                    },
                )
                if (transcript?.revised == true) {
                    Text("Smart revision applied", color = Aw.ReadyText, fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                }
            }
            transcript?.editNotice?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, style = AwType.Caption, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            }
            // Ambiguous voice edits: choose a match or keep the draft.
            transcript?.editChoices?.forEachIndexed { index, choice ->
                Spacer(Modifier.height(8.dp))
                ChoiceCard("Match ${index + 1}", choice, enabled = actionsEnabled) { onTextChanged(choice) }
            }
            if (!transcript?.editChoices.isNullOrEmpty()) {
                Spacer(Modifier.height(6.dp))
                AwPillButton("Keep draft", { onTextChanged(transcript.text) }, enabled = actionsEnabled, modifier = Modifier.fillMaxWidth())
            }

            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                SettingChip(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Rounded.AutoAwesome,
                    label = modelLabel,
                    detail = effortLabel,
                    description = "$modelLabel model, $effortLabel effort. Change",
                    onClick = { dialog = "model" },
                )
                SettingChip(
                    icon = if (state.approvalMode == ApprovalMode.ALLOW_CONTROLS) Icons.Rounded.TouchApp else Icons.Rounded.NotificationsNone,
                    label = null,
                    detail = null,
                    description = "${state.approvalMode.label} approvals. Change",
                    onClick = { dialog = "approval" },
                )
            }
            if (state.selectedSession?.status == SessionStatus.ACTIVE && !state.replyingFromChat) {
                Spacer(Modifier.height(7.dp))
                Text("Agent is working. Hold Send to steer or queue.", style = AwType.Micro, textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth())
            }

            // Secondary draft tools, only when they apply.
            if (transcript != null) {
                Spacer(Modifier.height(10.dp))
                AwSectionLabel(if (state.replyingFromChat) "Reply" else "Draft")
                Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    transcript?.undoText?.takeIf { !state.replyingFromChat }?.let {
                        ToolRow("Undo last change", null, Icons.AutoMirrored.Rounded.Undo, actionsEnabled, onUndo)
                    }
                    transcript?.rawText?.takeIf { !state.replyingFromChat }?.let { original ->
                        ToolRow(if (showOriginal) "Hide original" else "View original", null, Icons.Rounded.ViewList, actionsEnabled) { showOriginal = !showOriginal }
                        if (showOriginal) {
                            ChoiceCard("Original recording", original, enabled = actionsEnabled, actionLabel = "Restore original") {
                                onOriginal(); showOriginal = false
                            }
                        }
                    }
                    if (state.transcriptionEngine.usesBridge && !state.replyingFromChat) {
                        ToolRow(
                            "Retry transcription",
                            if (state.canRetryTranscript) "Same audio · current Mac backend" else "Record again to enable",
                            Icons.Rounded.Refresh,
                            actionsEnabled && state.canRetryTranscript,
                            onRetry,
                        )
                    }
                    AwRowCard(onClick = onBack, enabled = !state.pending, container = androidx.compose.ui.graphics.Color.Transparent, minHeight = 44.dp) {
                        Spacer(Modifier.weight(1f))
                        Text(if (state.replyingFromChat) "Cancel reply" else "Discard draft", color = Aw.ErrorText, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
                        Spacer(Modifier.weight(1f))
                    }
                }
            }

            state.error?.let { error ->
                Spacer(Modifier.height(10.dp))
                InlineError(error, initiallyOpen = state.showErrorDetails)
                if (ErrorRecoveryAction.REFRESH_SESSIONS in recoveryActionsForError(error)) {
                    Spacer(Modifier.height(6.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        AwPillButton("Refresh", onRefreshSessions, enabled = !state.pending, modifier = Modifier.weight(1f))
                        AwPillButton("Start new", onStartNewSession, primary = true, enabled = !state.pending, modifier = Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(4.dp))
                    Text("Refresh confirms the selected chat. Start new keeps this draft and sends nowhere until you tap Send.",
                        style = AwType.Micro, textAlign = TextAlign.Center)
                }
            }
            if (state.transcriptionEngine.usesBridge && !state.replyingFromChat) {
                Spacer(Modifier.height(10.dp))
                Text(
                    if (state.transcriptionEngine == TranscriptionEngine.BRIDGE_PHONON) "Voice edits run on your Mac. Review before sending."
                    else "Voice edits use your private bridge. Review before sending.",
                    style = AwType.Micro, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        AwEdgeButton(
            label = if (state.pending) "Sending…" else "Send",
            icon = if (state.pending) null else Icons.Rounded.ArrowUpward,
            enabled = canSend,
            onClick = { onSend(FollowUpAction.DEFAULT) },
            onLongClick = { dialog = "send" },
            onLongClickLabel = "Choose Steer or Queue",
        )

        AwDialog(visible = dialog == "model", onDismiss = { dialog = "" }) {
            ModelEffortDialog(state, onModel, onEffort, onDone = { dialog = "" })
        }
        AwDialog(visible = dialog == "approval", onDismiss = { dialog = "" }) {
            AwScrollColumn {
                AwScreenTitle("Approvals")
                Text("How the next approval reaches your wrist", style = AwType.Caption, textAlign = TextAlign.Center)
                Spacer(Modifier.height(4.dp))
                ApprovalMode.entries.forEach { mode ->
                    AwOption(mode.label, mode.description, state.approvalMode == mode, onClick = { onApprovalMode(mode); dialog = "" })
                }
            }
        }
        AwDialog(visible = dialog == "send", onDismiss = { dialog = "" }) {
            // Steer is the deliberate choice; Queue is the safe default on the edge.
            AwScrollColumn(topPadding = 36.dp, bottomPadding = 76.dp) {
                AwScreenTitle("Send")
                Text("Overrides your Codex default once", style = AwType.Caption, textAlign = TextAlign.Center)
                Spacer(Modifier.height(4.dp))
                SendChoice("Steer now", "Apply it to the active turn", Icons.AutoMirrored.Rounded.ArrowForward, canSend) { dialog = ""; onSend(FollowUpAction.STEER) }
            }
            AwEdgeButton("Queue next", icon = Icons.Rounded.ViewList, enabled = canSend, onClick = { dialog = ""; onSend(FollowUpAction.QUEUE) })
        }
    }
}

internal val ApprovalMode.label: String
    get() = when (this) {
        ApprovalMode.ALERT_ONLY -> "Alert only"
        ApprovalMode.ALLOW_CONTROLS -> "Allow controls"
    }

internal val ApprovalMode.description: String
    get() = when (this) {
        ApprovalMode.ALERT_ONLY -> "Notify here; decide in Codex"
        ApprovalMode.ALLOW_CONTROLS -> "Decide on the watch for watch-started turns"
    }

@Composable
private fun ComposerChip(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, enabled: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val interactions = remember { MutableInteractionSource() }
    Row(
        modifier
            .heightIn(min = 30.dp)
            .pressScale(interactions)
            .clip(Aw.PillShape)
            .background(Aw.SurfaceHigh)
            .clickable(interactionSource = interactions, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Aw.Text, modifier = Modifier.size(14.dp))
        Text(label, color = if (enabled) Aw.Text else Aw.TextTertiary, fontSize = 11.5.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun SettingChip(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String?,
    detail: String?,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interactions = remember { MutableInteractionSource() }
    Row(
        modifier
            .heightIn(min = 40.dp)
            .then(if (label == null) Modifier.width(40.dp) else Modifier)
            .pressScale(interactions)
            .clip(Aw.PillShape)
            .background(Aw.Surface)
            .border(1.dp, Aw.Line, Aw.PillShape)
            .clickable(interactionSource = interactions, indication = null, role = Role.Button, onClick = onClick)
            .padding(horizontal = if (label == null) 0.dp else 12.dp)
            .semantics(mergeDescendants = true) { contentDescription = description },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = if (label == null) Arrangement.Center else Arrangement.spacedBy(5.dp),
    ) {
        if (label == null) Icon(icon, contentDescription = null, tint = Aw.TextSecondary, modifier = Modifier.size(15.dp))
        if (label != null) {
            // Model name gets the room; effort stays fully visible after it.
            Text(label, color = Aw.Text, fontSize = 11.5.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false))
            if (detail != null) Text("· $detail", color = Aw.TextTertiary, fontSize = 11.5.sp, maxLines = 1, softWrap = false)
        }
    }
}

@Composable
private fun ToolRow(title: String, subtitle: String?, icon: androidx.compose.ui.graphics.vector.ImageVector, enabled: Boolean, onClick: () -> Unit) {
    AwRowCard(onClick = onClick, enabled = enabled, minHeight = 46.dp, modifier = Modifier.graphicsLayer { alpha = if (enabled) 1f else .5f }) {
        Icon(icon, contentDescription = null, tint = Aw.TextSecondary, modifier = Modifier.size(16.dp))
        AwRowText(title, subtitle, Modifier.weight(1f), titleLines = 1)
    }
}

@Composable
private fun ChoiceCard(label: String, text: String, enabled: Boolean, actionLabel: String = "Use", onUse: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(Aw.Surface)
            .border(1.dp, Aw.Line, RoundedCornerShape(18.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(label, style = AwType.Micro.copy(fontWeight = FontWeight.SemiBold))
        Text(text, style = AwType.Body.copy(fontSize = 13.sp))
        AwPillButton(if (actionLabel == "Use") "Use ${label.lowercase()}" else actionLabel, onUse, enabled = enabled, height = 36.dp, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun SendChoice(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, enabled: Boolean, onClick: () -> Unit) {
    AwRowCard(onClick = onClick, enabled = enabled, container = Aw.SurfaceRaised) {
        Icon(icon, contentDescription = null, tint = Aw.Text, modifier = Modifier.size(17.dp))
        AwRowText(title, subtitle, Modifier.weight(1f))
    }
}

@Composable
private fun BoxScope.ModelEffortDialog(
    state: WearUiState,
    onModel: (String?) -> Unit,
    onEffort: (String) -> Unit,
    onDone: () -> Unit,
) {
    val selected = state.models.firstOrNull { it.model == state.selectedModel }
    val efforts = ReasoningEffortPolicy.options(selected)
    val currentEffort = ReasoningEffortPolicy.normalize(state.reasoningEffort)
    val options = listOf<ModelOption?>(null) + state.models
    AwScrollColumn(bottomPadding = 76.dp) {
        AwScreenTitle("Model")
        AwSectionLabel("Reasoning effort")
        // Segmented effort control; wraps to two rows when a model offers many levels.
        efforts.chunked(4).forEach { row ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(Aw.PillShape)
                    .background(Aw.Surface)
                    .border(1.dp, Aw.Line, Aw.PillShape)
                    .padding(3.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                row.forEach { effort ->
                    val on = effort == currentEffort
                    val label = ReasoningEffortPolicy.label(effort)
                    Box(
                        Modifier
                            .weight(1f)
                            .heightIn(min = 36.dp)
                            .clip(Aw.PillShape)
                            .background(if (on) Aw.Text else androidx.compose.ui.graphics.Color.Transparent)
                            .clickable(role = Role.RadioButton) { onEffort(effort) }
                            .semantics { this.selected = on; contentDescription = "$label effort"; stateDescription = if (on) "Selected" else "Not selected" },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(shortEffort(label), color = if (on) Aw.OnPrimary else Aw.TextSecondary, fontSize = 11.sp,
                            fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium, maxLines = 1)
                    }
                }
            }
        }
        AwSectionLabel("Model · next turn")
        options.forEach { option ->
            val isSelected = option?.model == state.selectedModel || (option == null && state.selectedModel == null)
            AwOption(
                title = option?.displayName ?: "Auto",
                subtitle = option?.let { "Default effort · ${ReasoningEffortPolicy.label(it.defaultReasoningEffort)}" } ?: "Current Codex model",
                selected = isSelected,
                onClick = { onModel(option?.model) },
            )
        }
    }
    AwEdgeButton("Done", onClick = onDone)
}

private fun shortEffort(label: String): String = when (label) {
    "Medium" -> "Med"
    "Extra High" -> "XHigh"
    else -> label
}

@Composable
internal fun InlineError(message: String, initiallyOpen: Boolean) {
    var open by rememberSaveable(message, initiallyOpen) { mutableStateOf(initiallyOpen) }
    val presentation = errorDetailPresentation(message)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Aw.ErrorSurface)
            .border(1.dp, Aw.Error.copy(alpha = .35f), RoundedCornerShape(16.dp))
            .clickable(role = Role.Button) { open = true }
            .padding(horizontal = 10.dp, vertical = 8.dp)
            .semantics { contentDescription = presentation.contentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(Icons.Rounded.ErrorOutline, contentDescription = null, tint = Aw.ErrorText, modifier = Modifier.size(14.dp))
        Text(presentation.fullText, color = Aw.ErrorSoft, fontSize = 11.sp, lineHeight = 14.sp, maxLines = 2,
            overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Text("Details", color = Aw.ErrorText, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
    }
    if (open) ErrorDetailDialog("Error details", presentation.fullText, onDismiss = { open = false })
}
