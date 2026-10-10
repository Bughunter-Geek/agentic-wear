package io.github.sirbughunter.agenticwear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ContentPaste
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Science
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.Text
import io.github.sirbughunter.agenticwear.BuildConfig
import io.github.sirbughunter.agenticwear.data.AppPreferences
import io.github.sirbughunter.agenticwear.live.LiveVoiceColour
import io.github.sirbughunter.agenticwear.model.ApprovalMode
import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import io.github.sirbughunter.agenticwear.update.UpdateStage
import io.github.sirbughunter.agenticwear.update.UpdateUiState
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

@Composable
internal fun SettingsScreen(
    state: WearUiState,
    onEngine: (TranscriptionEngine) -> Unit,
    onApprovalMode: (ApprovalMode) -> Unit,
    onCollapseUpdates: (Boolean) -> Unit,
    onUpdate: () -> Unit,
    onDisconnect: () -> Unit,
    onLiveCall: () -> Unit,
) {
    val context = LocalContext.current
    val preferences = remember { AppPreferences(context) }
    var colour by remember { mutableStateOf(LiveVoiceColour.fromLabel(preferences.liveVoiceColour)) }
    Box(Modifier.fillMaxSize().background(Aw.Bg)) {
        AwScrollColumn(bottomPadding = 40.dp) {
            AwScreenTitle("Settings")

            AwSectionLabel("App updates")
            Text("Installed ${BuildConfig.VERSION_NAME} · build ${BuildConfig.VERSION_CODE}",
                style = AwType.Micro, textAlign = TextAlign.Center)
            UpdateRow(state.appUpdate, onUpdate)

            AwSectionLabel("Live voice")
            AwRowCard(onClick = onLiveCall) {
                Icon(Icons.Rounded.GraphicEq, contentDescription = null, tint = Aw.TextSecondary, modifier = Modifier.size(17.dp))
                AwRowText("Live conversation", "Talk with the selected chat", Modifier.weight(1f))
            }
            AwSectionLabel("Orb colour")
            OrbSwatches(colour) { choice ->
                colour = choice
                preferences.liveVoiceColour = choice.label
            }

            AwSectionLabel("Dictation")
            AwOption("Phonon-2", "English only · runs on your Mac · experimental", state.transcriptionEngine == TranscriptionEngine.BRIDGE_PHONON,
                onClick = { onEngine(TranscriptionEngine.BRIDGE_PHONON) })
            AwOption("Private Whisper", "Free · multilingual · runs on your Mac", state.transcriptionEngine == TranscriptionEngine.BRIDGE_WHISPER,
                onClick = { onEngine(TranscriptionEngine.BRIDGE_WHISPER) })
            AwOption("Device speech", "Faster · limited language switching", state.transcriptionEngine == TranscriptionEngine.DEVICE_SPEECH,
                onClick = { onEngine(TranscriptionEngine.DEVICE_SPEECH) })

            AwSectionLabel("Approvals")
            AwOption("Alert only", "Safest default for every chat", state.approvalMode == ApprovalMode.ALERT_ONLY,
                onClick = { onApprovalMode(ApprovalMode.ALERT_ONLY) })
            AwOption("Allow controls", "Decide on the watch for watch-started turns", state.approvalMode == ApprovalMode.ALLOW_CONTROLS,
                onClick = { onApprovalMode(ApprovalMode.ALLOW_CONTROLS) })

            AwSectionLabel("Chat")
            AwToggleRow("Collapse updates", "Answers always stay open", state.collapseUpdates, onCollapseUpdates)

            AwSectionLabel("Your dot")
            AwRowCard(onClick = {}, enabled = false) {
                Icon(Icons.Rounded.Link, contentDescription = null, tint = Aw.TextTertiary, modifier = Modifier.size(16.dp))
                AwRowText("Not linked", "Needs a supported account link from your Mac. Use your dot in the ChatGPT app meanwhile.",
                    Modifier.weight(1f), subtitleColor = Aw.TextTertiary)
            }

            AwRowCard(onClick = {}, enabled = false, minHeight = 46.dp) {
                Icon(Icons.Rounded.Science, contentDescription = null, tint = Aw.Attention, modifier = Modifier.size(16.dp))
                AwRowText("${BuildConfig.RELEASE_CHANNEL} ${BuildConfig.VERSION_NAME}", "Testing build · not stable", Modifier.weight(1f), subtitleColor = Aw.Attention)
            }

            Spacer(Modifier.height(4.dp))
            AwRowCard(onClick = onDisconnect, container = Color.Transparent, minHeight = 44.dp) {
                Spacer(Modifier.weight(1f))
                Text("Disconnect bridge", color = Aw.ErrorText, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.weight(1f))
            }
            Text(
                "Unofficial open-source companion. Not affiliated with or endorsed by OpenAI.",
                style = AwType.Micro, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 6.dp),
            )
            Text("${BuildConfig.RELEASE_CHANNEL} ${BuildConfig.VERSION_NAME} · build ${BuildConfig.VERSION_CODE}", style = AwType.Micro, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun OrbSwatches(selected: LiveVoiceColour, onPick: (LiveVoiceColour) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp), horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        LiveVoiceColour.entries.chunked(5).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                row.forEach { colour ->
                    val palette = colour.orbPalette()
                    val on = colour == selected
                    Box(
                        Modifier
                            .size(30.dp)
                            .clip(CircleShape)
                            .clickable(role = Role.RadioButton) { onPick(colour) }
                            .semantics { this.selected = on; contentDescription = "${colour.label} orb" }
                            .border(2.dp, if (on) Aw.Text else Color.Transparent, CircleShape)
                            .padding(4.dp)
                            .clip(CircleShape)
                            .background(Brush.radialGradient(listOf(palette.light, palette.base, palette.deep))),
                    )
                }
            }
        }
    }
}

@Composable
private fun UpdateRow(update: UpdateUiState, onClick: () -> Unit) {
    if (!update.enabled) {
        AwRowCard(onClick = {}, enabled = false) {
            Icon(Icons.Rounded.Download, contentDescription = null, tint = Aw.TextTertiary, modifier = Modifier.size(16.dp))
            AwRowText("Updates unavailable", if (BuildConfig.PRIVATE_UPDATES_ONLY) "Connect your Mac to check for private updates" else "Updates are not configured for this build", Modifier.weight(1f))
        }
        return
    }
    val release = "${BuildConfig.RELEASE_CHANNEL} ${update.release?.versionName.orEmpty()}".trim()
    val title = when (update.stage) {
        UpdateStage.IDLE -> "Check for updates"
        UpdateStage.CHECKING -> "Checking for updates…"
        UpdateStage.AVAILABLE -> "Update available"
        UpdateStage.DOWNLOADING -> "Downloading update…"
        UpdateStage.READY -> "Install update"
        UpdateStage.CURRENT -> "Check for updates"
        UpdateStage.ERROR -> "Update unavailable"
    }
    val subtitle = when (update.stage) {
        UpdateStage.IDLE -> if (BuildConfig.PRIVATE_UPDATES_ONLY) "Signed builds from your paired private relay" else "Signed ${BuildConfig.RELEASE_CHANNEL.lowercase()} builds from GitHub"
        UpdateStage.CHECKING -> if (BuildConfig.PRIVATE_UPDATES_ONLY) "Checking private channel · tap to restart" else "Checking two sources · tap to restart"
        UpdateStage.AVAILABLE -> "$release · tap to download and install"
        UpdateStage.DOWNLOADING -> if (update.progress > 0) "${update.progress}% · tap to cancel" else "Starting download · tap to cancel"
        UpdateStage.READY -> "$release · ${update.message ?: "Tap to open the system installer"}"
        UpdateStage.CURRENT -> "Up to date · tap to check again"
        UpdateStage.ERROR -> "${update.message ?: "Could not check"} · tap to retry"
    }
    val (icon, tint) = when (update.stage) {
        UpdateStage.CURRENT -> Icons.Rounded.Check to Aw.ReadyText
        UpdateStage.ERROR -> Icons.Rounded.ErrorOutline to Aw.ErrorText
        else -> Icons.Rounded.Download to Aw.Text
    }
    AwRowCard(onClick = onClick) {
        if (update.stage == UpdateStage.CHECKING || update.stage == UpdateStage.DOWNLOADING) StatusIndicator(StatusKind.Working)
        else Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
        AwRowText(title, subtitle, Modifier.weight(1f))
    }
}

// ─────────────────────────────── Pairing ───────────────────────────────

@Composable
internal fun PairScreen(
    relayDefault: String,
    codeDefault: String,
    pending: Boolean,
    error: String?,
    onPair: (String, String) -> Unit,
) {
    var code by rememberSaveable(codeDefault) { mutableStateOf(sanitizePairingCodeInput(codeDefault)) }
    var relay by rememberSaveable(relayDefault) { mutableStateOf(relayDefault) }
    var editRelay by rememberSaveable { mutableStateOf(relayDefault.isBlank()) }
    val normalized = normalizePairingCodeInput(code)
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val palette = remember { LiveVoiceColour.fromLabel(AppPreferences(context).liveVoiceColour).orbPalette() }
    Box(Modifier.fillMaxSize().background(Aw.Bg)) {
        AwScrollColumn(topPadding = 28.dp, bottomPadding = 76.dp, spacing = 5.dp) {
            CloudOrb(palette, OrbMode.Idle, 0f, 0f, Modifier.size(24.dp))
            Text("Connect your Mac", style = AwType.Title, textAlign = TextAlign.Center)
            Text("Run pair on your bridge, then enter its code.", style = AwType.Micro.copy(fontSize = 10.5.sp), textAlign = TextAlign.Center)
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 46.dp)
                    .clip(Aw.PillShape)
                    .background(Aw.Surface)
                    .border(1.dp, Aw.SurfaceHigh, Aw.PillShape)
                    .padding(start = 16.dp, end = 4.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                BasicTextField(
                    value = code,
                    onValueChange = { code = sanitizePairingCodeInput(it) },
                    singleLine = true,
                    textStyle = TextStyle(color = Aw.Text, fontSize = 15.sp, fontFamily = FontFamily.Monospace, letterSpacing = 2.sp, textAlign = TextAlign.Center),
                    cursorBrush = SolidColor(Aw.Text),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                    modifier = Modifier.fillMaxWidth().padding(end = 40.dp).semantics { contentDescription = "Eight-character pairing code" },
                    decorationBox = { inner ->
                        Box(contentAlignment = Alignment.Center) {
                            if (code.isEmpty()) Text("XXXX-XXXX", color = Color(0xFF555555), fontSize = 15.sp, fontFamily = FontFamily.Monospace, letterSpacing = 2.sp)
                            inner()
                        }
                    },
                )
                AwCircleButton(
                    Icons.Rounded.ContentPaste, "Paste pairing code",
                    onClick = {
                        scope.launch {
                            clipboard.getClipEntry()?.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)
                                ?.coerceToText(context)?.toString()?.let(::extractPairingCode)?.let { code = it }
                        }
                    },
                    size = 36.dp, container = Aw.SurfaceHigh, bordered = false,
                    modifier = Modifier.align(Alignment.CenterEnd).offset(x = 6.dp),
                )
            }
            if (editRelay) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 40.dp)
                        .clip(Aw.PillShape)
                        .background(Aw.Surface)
                        .border(1.dp, Aw.SurfaceHigh, Aw.PillShape)
                        .padding(horizontal = 14.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    BasicTextField(
                        value = relay,
                        onValueChange = { relay = it.take(240) },
                        singleLine = true,
                        textStyle = TextStyle(color = Aw.Text, fontSize = 11.5.sp),
                        cursorBrush = SolidColor(Aw.Text),
                        modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Relay URL" },
                        decorationBox = { inner -> if (relay.isEmpty()) Text("Relay URL", color = Aw.TextTertiary, fontSize = 11.5.sp); inner() },
                    )
                }
            } else {
                AwRowCard(onClick = { editRelay = true }, container = Color.Transparent, minHeight = 40.dp) {
                    Icon(Icons.Rounded.Link, contentDescription = null, tint = Aw.TextTertiary, modifier = Modifier.size(14.dp))
                    Text("Relay: Default", style = AwType.Caption, modifier = Modifier.weight(1f))
                    Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = null, tint = Aw.TextTertiary, modifier = Modifier.size(15.dp))
                }
            }
            error?.let { InlineError(it, initiallyOpen = false) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(Icons.Rounded.Lock, contentDescription = null, tint = Aw.TextTertiary, modifier = Modifier.size(11.dp))
                Text("End-to-end encrypted · unofficial", style = AwType.Micro)
            }
        }
        AwEdgeButton(
            label = if (pending) "Connecting…" else "Connect",
            enabled = !pending && normalized.length == 8 && relay.isNotBlank(),
            onClick = { onPair(normalized, relay) },
        )
    }
}

// ─────────────────────────────── Dialogs ───────────────────────────────

@Composable
internal fun InstallPermissionPrompt(onContinue: () -> Unit, onDismiss: () -> Unit) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Aw.Bg.copy(alpha = .97f))
            .clickable(interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, indication = null) {},
    ) {
        AwScrollColumn(bottomPadding = 76.dp) {
            Box(Modifier.size(42.dp).clip(CircleShape).background(Aw.Working.copy(alpha = .14f)), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Download, contentDescription = null, tint = Aw.Working, modifier = Modifier.size(20.dp))
            }
            Text("One-time permission", style = AwType.Title, textAlign = TextAlign.Center)
            Text("Android’s installer opens next. If it blocks the update, tap Settings there and allow Agentic Wear. Your data stays intact.",
                style = AwType.Caption, textAlign = TextAlign.Center)
            AwRowCard(onClick = onDismiss, container = Color.Transparent, minHeight = 40.dp) {
                Spacer(Modifier.weight(1f)); Text("Not now", style = AwType.Label); Spacer(Modifier.weight(1f))
            }
        }
        AwEdgeButton("Continue", onClick = onContinue)
    }
}

/** Full-screen, crown-scrollable detail text (error details). */
@Composable
internal fun ErrorDetailDialog(title: String, message: String, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Aw.Bg).semantics { contentDescription = "$title. Full-screen dialog." }) {
            AwScrollColumn(bottomPadding = 76.dp) {
                Text(title, color = Aw.ErrorText, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                Text(message, style = AwType.Body.copy(fontSize = 12.5.sp, lineHeight = 17.sp), textAlign = TextAlign.Center)
            }
            AwEdgeButton("Close", onClick = onDismiss)
        }
    }
}

// ─────────────────────────────── Geometry ───────────────────────────────

internal fun roundSafeEndPadding(
    screenWidth: Dp,
    screenHeight: Dp,
    centerY: Dp,
    targetRadius: Dp,
    margin: Dp,
): Dp {
    val displayRadius = min(screenWidth.value, screenHeight.value) / 2f
    val safeCenterRadius = max(0f, displayRadius - targetRadius.value - margin.value)
    val verticalDistance = abs(centerY.value - screenHeight.value / 2f)
    val horizontalDistance = sqrt(max(0f, safeCenterRadius * safeCenterRadius - verticalDistance * verticalDistance))
    val centerX = screenWidth.value / 2f + horizontalDistance
    return max(margin.value, screenWidth.value - centerX - targetRadius.value).dp
}

internal fun isCancelFieldTap(distance: Float, innerRadius: Float, outerRadius: Float): Boolean =
    distance >= innerRadius && distance <= outerRadius
