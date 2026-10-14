package io.github.sirbughunter.agenticwear.ui

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Laptop
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Cloud
import androidx.compose.material.icons.rounded.NotificationsNone
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.Text
import io.github.sirbughunter.agenticwear.data.AppPreferences
import io.github.sirbughunter.agenticwear.live.LiveVoiceColour
import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AgentSession
import io.github.sirbughunter.agenticwear.model.AlertKind
import io.github.sirbughunter.agenticwear.model.ApprovalMode
import io.github.sirbughunter.agenticwear.model.SessionStatus
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

private val TaskViews = listOf("All", "Priority", "Pinned", "Scheduled", "Activity")

/** Chats from the paired host; the separate account dot remains explicit. */
@Composable
internal fun SessionsScreen(
    state: WearUiState,
    onBack: () -> Unit,
    onSelect: (String) -> Unit,
    initialGroup: String = "All",
    activity: List<AgentAlert>? = null,
    onOpenActivity: ((AgentAlert) -> Unit)? = null,
    onSettings: (() -> Unit)? = null,
    onActivity: (() -> Unit)? = null,
    palette: OrbPalette = LiveVoiceColour.TEAL.orbPalette(),
) {
    var group by rememberSaveable { mutableStateOf(initialGroup) }
    var choosing by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    val alerts = remember(activity, group) { (activity ?: AppPreferences(context).alertHistory()).asReversed() }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val priority = remember(state.sessions, group, alerts) {
        if (group == "Priority") prioritySessions(state.sessions, alerts, AppPreferences(context).chatLastOpened()) else emptyList()
    }
    val filtered = when (group) {
        "Priority" -> priority.map { it.session }
        "Pinned" -> state.sessions.filter { it.pinned }
        "Scheduled", "Activity" -> emptyList()
        else -> state.sessions
    }
    Box(Modifier.fillMaxSize().background(Aw.Bg)) {
        AwLazyColumn(state = listState) {
            item(key = "title") {
                // The title doubles as the task-view picker.
                AwRowCard(onClick = { choosing = !choosing }, minHeight = 40.dp, container = Color.Transparent,
                    modifier = Modifier.semantics { contentDescription = "${if (group == "All") "Chats" else group}. Change view" }) {
                    Spacer(Modifier.weight(1f))
                    Text(if (group == "All") "Chats" else group, style = AwType.Title)
                    Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = null, tint = Aw.TextSecondary, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.weight(1f))
                }
            }
            if (choosing) {
                items(TaskViews, key = { "view:$it" }) { name ->
                    AwOption(name, null, group == name, onClick = {
                        group = name; choosing = false; scope.launch { listState.scrollToItem(0) }
                    })
                }
            }
            onSettings?.let { open -> item(key = "settings-link") { PlainLink("Settings", Icons.Rounded.Tune, open) } }
            when (group) {
                "Scheduled" -> {
                    item { BoundaryNote("Schedules live in Codex", "Scheduled task definitions are unavailable on this local host.") }
                    val runs = state.sessions.filter { it.source == "automation" }
                    if (runs.isNotEmpty()) item { AwSectionLabel("Recent automation runs") }
                    items(runs, key = { "run:${it.id}" }) { SessionRow(it, state.selectedThreadId, onSelect, modifier = glideModifier()) }
                }
                "Activity" -> {
                    if (alerts.isEmpty()) item { BoundaryNote("No activity yet", "Task completions, errors and permission requests appear here.") }
                    items(alerts, key = { "event:${it.eventId}" }) { alert ->
                        ActivityRow(alert) { onOpenActivity?.invoke(alert) ?: onActivity?.invoke() }
                    }
                }
                else -> {
                    if (group == "Priority" && filtered.isNotEmpty()) item { Text("Running chats, questions waiting for you, and replies you haven’t opened.", style = AwType.Micro, textAlign = TextAlign.Center) }
                    if (filtered.isEmpty()) {
                        item {
                            when (group) {
                                "Pinned" -> BoundaryNote("No pinned chats", "Open Codex on your Mac, then come back.")
                                "Priority" -> BoundaryNote("Nothing needs you", "Running chats, questions waiting for you, and replies you haven’t opened appear here.")
                                else -> BoundaryNote("No chats yet", "Open Codex on your Mac, then come back.")
                            }
                        }
                    } else if (group == "All") {
                        val pinned = filtered.filter { it.pinned }
                        val recent = filtered.filterNot { it.pinned }
                        if (pinned.isNotEmpty()) {
                            item(key = "pinned-label") { AwSectionLabel("Pinned") }
                            items(pinned, key = { "p:${it.id}" }) { SessionRow(it, state.selectedThreadId, onSelect, modifier = glideModifier()) }
                        }
                        if (recent.isNotEmpty()) {
                            item(key = "recent-label") { AwSectionLabel("Recent") }
                            items(recent, key = { "r:${it.id}" }) { SessionRow(it, state.selectedThreadId, onSelect, modifier = glideModifier()) }
                        }
                    } else if (group == "Priority") {
                        items(priority, key = { it.session.id }) { SessionRow(it.session, state.selectedThreadId, onSelect, it.reason, glideModifier()) }
                    } else {
                        items(filtered, key = { it.id }) { SessionRow(it, state.selectedThreadId, onSelect, modifier = glideModifier()) }
                    }
                    if (group == "All" && state.sessions.none { it.source == "dot" }) item(key = "dot") { Box(Modifier.padding(top = 6.dp)) { DotCard(palette) } }
                    item {
                        Text(
                            buildString {
                                append("${filtered.size} chats. ")
                                if (state.localInventoryComplete == false) append("Partial results; refresh to retry. ")
                            },
                            style = AwType.Micro, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp),
                        )
                    }
                }
            }
            if (onActivity != null || onSettings != null) item { Spacer(Modifier.height(4.dp)) }
            onActivity?.let { open -> item(key = "activity-link") { PlainLink("Activity", Icons.Rounded.NotificationsNone, open) } }
        }
    }
}

@Composable
private fun DotCard(palette: OrbPalette) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 54.dp)
            .clip(Aw.CardShape)
            .background(Color(0xFF0F0F0F))
            .border(1.dp, Aw.LineStrong.copy(alpha = .14f), Aw.CardShape)
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .semantics(mergeDescendants = true) { contentDescription = "Your dot. Open your Dot in Chrome on your Mac to show it here." },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        val context = LocalContext.current
        val avatar = remember { DotAvatar.fromLabel(AppPreferences(context).dotAvatar) }
        DotFigure(avatar, DotMood.FROZEN, Modifier.size(28.dp))
        AwRowText("Your dot", "Open your Dot in Chrome on your Mac", Modifier.weight(1f), subtitleColor = Aw.TextTertiary, titleLines = 1)
    }
}

/** Lets chat rows glide to a new place and fade in or out when the list reorders. */
private fun androidx.compose.foundation.lazy.LazyItemScope.glideModifier(): Modifier =
    Modifier.animateItem(fadeInSpec = tween(220), placementSpec = spring(stiffness = Spring.StiffnessMediumLow), fadeOutSpec = tween(160))

@Composable
private fun SessionRow(session: AgentSession, selectedId: String?, onSelect: (String) -> Unit, reason: PriorityReason? = null, modifier: Modifier = Modifier) {
    val ago = shortAgo(session.updatedAtMillis)
    val meta = buildString {
        append(reason?.label ?: session.status.label)
        if (session.status != SessionStatus.ERROR && session.updatedAtMillis > 0) append(" · ").append(ago)
        if (session.ownedByWear) append(" · Watch")
    }
    AwRowCard(
        onClick = { onSelect(session.id) },
        selected = session.id == selectedId,
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = "${session.title}, $meta${sourceLabel(session.source)?.let { ", $it chat" }.orEmpty()}" },
    ) {
        StatusIndicator(session.status.kind())
        Column(Modifier.weight(1f)) {
            Text(session.title, style = AwType.Row, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (session.source == "dot") {
                    val context = LocalContext.current
                    val avatar = remember { DotAvatar.fromLabel(AppPreferences(context).dotAvatar) }
                    DotFigure(avatar, if (session.status == SessionStatus.ACTIVE) DotMood.THINKING else DotMood.IDLE, Modifier.size(13.dp))
                } else Icon(sessionSourceIcon(session.source), contentDescription = null, tint = Aw.TextTertiary, modifier = Modifier.size(11.dp))
                Text(meta, color = session.status.textColor, fontSize = 10.5.sp, lineHeight = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

internal enum class SessionSourceGlyph { MAC, CLOUD, DOT }

internal fun sessionSourceGlyph(source: String?): SessionSourceGlyph = when (source) {
    "cloud" -> SessionSourceGlyph.CLOUD
    "dot" -> SessionSourceGlyph.DOT
    else -> SessionSourceGlyph.MAC
}

private fun sessionSourceIcon(source: String?) = when (sessionSourceGlyph(source)) {
    SessionSourceGlyph.CLOUD -> Icons.Rounded.Cloud
    SessionSourceGlyph.DOT -> Icons.Rounded.AutoAwesome
    SessionSourceGlyph.MAC -> Icons.Rounded.Laptop
}

/** Compact relative time for list rows: now, 5m, 3h, 2d. */
internal fun shortAgo(millis: Long, now: Long = System.currentTimeMillis()): String {
    val minutes = (now - millis).coerceAtLeast(0) / 60_000
    return when {
        minutes < 1 -> "now"
        minutes < 60 -> "${minutes}m"
        minutes < 24 * 60 -> "${minutes / 60}h"
        else -> "${minutes / (24 * 60)}d"
    }
}

@Composable
private fun BoundaryNote(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 10.dp, horizontal = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = AwType.Row, textAlign = TextAlign.Center)
        Spacer(Modifier.height(3.dp))
        Text(body, style = AwType.Caption, textAlign = TextAlign.Center)
    }
}

@Composable
private fun PlainLink(label: String, icon: ImageVector, onClick: () -> Unit) {
    AwRowCard(onClick = onClick, container = Color.Transparent, minHeight = 46.dp) {
        Spacer(Modifier.weight(1f))
        Icon(icon, contentDescription = null, tint = Aw.TextSecondary, modifier = Modifier.size(15.dp))
        Text(label, color = Aw.Text, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.weight(1f))
    }
}

private data class AlertLook(val label: String, val color: Color, val surface: Color, val icon: ImageVector)

private fun AgentAlert?.look(readOnly: Boolean, decisionNeeded: Boolean): AlertLook = when (this?.kind) {
    AlertKind.COMPLETE -> AlertLook("Done", Aw.ReadyText, Aw.Ready.copy(alpha = .14f), Icons.Rounded.Check)
    AlertKind.PERMISSION -> AlertLook(if (decisionNeeded && !readOnly) "Decision needed" else "Permission requested", Aw.Attention, Aw.Attention.copy(alpha = .14f), Icons.Rounded.Security)
    AlertKind.ERROR -> AlertLook("Stopped", Aw.ErrorText, Aw.Error.copy(alpha = .14f), Icons.Rounded.ErrorOutline)
    AlertKind.QUESTION -> AlertLook("Question", Aw.Attention, Aw.Attention.copy(alpha = .14f), Icons.Rounded.Security)
    null -> AlertLook("Nothing yet", Aw.TextSecondary, Aw.SurfaceRaised, Icons.Rounded.NotificationsNone)
}

private fun AgentAlert.time(): String = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(occurredAtMillis))

@Composable
private fun ActivityRow(alert: AgentAlert, onClick: () -> Unit) {
    val look = alert.look(readOnly = true, decisionNeeded = false)
    AwRowCard(onClick = onClick, modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "${look.label} at ${alert.time()}: ${alert.title}" }) {
        Box(Modifier.size(26.dp).clip(CircleShape).background(look.surface), contentAlignment = Alignment.Center) {
            Icon(look.icon, contentDescription = null, tint = look.color, modifier = Modifier.size(14.dp))
        }
        Column(Modifier.weight(1f)) {
            Text("${look.label} · ${alert.time()}", color = look.color, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold)
            Text(alert.title, style = AwType.Row, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Activity: the last events this watch received, newest first. */
@Composable
internal fun ActivityScreen(onOpen: (AgentAlert) -> Unit) {
    val context = LocalContext.current
    val alerts = remember { AppPreferences(context).alertHistory().asReversed() }
    Box(Modifier.fillMaxSize().background(Aw.Bg)) {
        AwLazyColumn {
            item { AwScreenTitle("Activity") }
            if (alerts.isEmpty()) item { BoundaryNote("No activity yet", "Task completions, errors and permission requests appear here.") }
            items(alerts, key = { it.eventId }) { alert -> ActivityRow(alert) { onOpen(alert) } }
            item { Text("The last 20 events this watch received", style = AwType.Micro, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp)) }
        }
    }
}

@Composable
internal fun AlertScreen(
    alert: AgentAlert?,
    readOnly: Boolean = false,
    approvalMode: ApprovalMode,
    pending: Boolean,
    onBack: () -> Unit,
    onApprove: () -> Unit,
    onDecline: () -> Unit,
    onOpenChat: (String) -> Unit,
) {
    val canDecide = canRespondToAlert(alert, approvalMode, readOnly)
    val look = alert.look(readOnly, decisionNeeded = alert?.canControl == true && !alert.approvalId.isNullOrBlank())
    Box(Modifier.fillMaxSize().background(Aw.Bg)) {
        val hasChat = alert != null && alert.threadId.isNotBlank()
        AwScrollColumn(topPadding = 28.dp, bottomPadding = if (hasChat && !canDecide) 76.dp else 36.dp, spacing = 5.dp) {
            if (readOnly) Text("Past event · read only", style = AwType.Micro)
            if (canDecide) {
                // Deciding: no hero icon, so Allow and Decline land inside the round safe area.
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Icon(look.icon, contentDescription = null, tint = look.color, modifier = Modifier.size(14.dp))
                    Text("${look.label} · ${alert!!.time()}", color = look.color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
            } else {
                Box(Modifier.size(34.dp).clip(CircleShape).background(look.surface), contentAlignment = Alignment.Center) {
                    Icon(look.icon, contentDescription = null, tint = look.color, modifier = Modifier.size(18.dp))
                }
                Text(
                    buildString { append(look.label); alert?.let { append(" · ").append(it.time()) } },
                    color = look.color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                )
            }
            Text(alert?.title ?: "Nothing to show", style = AwType.Title.copy(fontSize = 14.sp, lineHeight = 18.sp),
                textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(alert?.detail ?: "Agent alerts will appear here.", style = AwType.Caption.copy(fontSize = 12.sp, lineHeight = 16.sp),
                textAlign = TextAlign.Center, maxLines = if (canDecide) 3 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis)
            if (canDecide) {
                Spacer(Modifier.height(3.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    AwPillButton("Decline", onDecline, enabled = !pending, modifier = Modifier.weight(1f))
                    AwPillButton("Allow", onApprove, primary = true, enabled = !pending, modifier = Modifier.weight(1f))
                }
                Text("This turn only", style = AwType.Micro)
                if (hasChat) {
                    AwRowCard(onClick = { onOpenChat(alert!!.threadId) }, enabled = !pending, container = Color.Transparent, minHeight = 44.dp) {
                        Spacer(Modifier.weight(1f)); Text("Open chat", style = AwType.Label.copy(color = Aw.Text)); Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
        if (hasChat && !canDecide) {
            AwEdgeButton("Open chat", onClick = { onOpenChat(alert!!.threadId) }, enabled = !pending)
        }
    }
}
