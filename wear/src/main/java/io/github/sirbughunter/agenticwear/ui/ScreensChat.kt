package io.github.sirbughunter.agenticwear.ui

import android.animation.ValueAnimator
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.ThumbDown
import androidx.compose.material.icons.rounded.ThumbUp
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.Text
import io.github.sirbughunter.agenticwear.model.ApprovalMode
import io.github.sirbughunter.agenticwear.model.ChatDisplayPolicy
import io.github.sirbughunter.agenticwear.model.ChatMessage
import io.github.sirbughunter.agenticwear.model.ChatMessageKind
import io.github.sirbughunter.agenticwear.model.ChatPhase
import io.github.sirbughunter.agenticwear.model.ChatRole
import io.github.sirbughunter.agenticwear.model.FeedbackRating
import io.github.sirbughunter.agenticwear.model.MAX_QUESTION_OPTIONS
import io.github.sirbughunter.agenticwear.model.isAnsweredLocally
import io.github.sirbughunter.agenticwear.model.SessionStatus
import io.github.sirbughunter.agenticwear.model.SubmissionPhase
import io.github.sirbughunter.agenticwear.model.currentSubmission
import io.github.sirbughunter.agenticwear.model.visibleSubmissions
import io.github.sirbughunter.agenticwear.model.submittedChatMessages
import io.github.sirbughunter.agenticwear.model.submissionStatusLabel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

@Composable
internal fun ChatScreen(
    state: WearUiState,
    onReply: () -> Unit,
    onRetry: () -> Unit,
    onDismissSubmission: (String) -> Unit = {},
    onRateMessage: (ChatMessage, FeedbackRating) -> Unit,
    onPermissionResponse: (ChatMessage, Boolean) -> Unit,
    palette: OrbPalette,
    onAnswerQuestion: (ChatMessage, String) -> Unit = { _, _ -> },
    onReplyToQuestion: (ChatMessage) -> Unit = {},
) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val chat = state.chat?.takeIf { it.threadId == state.selectedThreadId || (state.selectedThreadId == null && state.sendingDraft == null) }
    val submissions = visibleSubmissions(state.submittedTurns.filter { it.threadId == state.selectedThreadId }) + listOfNotNull(state.sendingDraft)
    val submission = currentSubmission(chat, submissions)
    val messages = submittedChatMessages(chat, submissions)
    val hasPendingPermission = messages.any { it.kind == ChatMessageKind.PERMISSION && !it.resolved }
    val hasActionablePermission = messages.any {
        it.kind == ChatMessageKind.PERMISSION && it.canControl && !it.resolved && state.approvalMode == ApprovalMode.ALLOW_CONTROLS
    }
    val isWorking = submission == null && chat?.status == SessionStatus.ACTIVE
    val agentThinking = isWorking && !hasPendingPermission && state.error == null
    val submissionLabel = if (hasPendingPermission) null else submission?.let { submissionStatusLabel(it, state.pending, chat) }
    val followRevision = ChatFollowRevision(messages, agentThinking, state.error, state.sendNotice, submissionLabel)
    val lastContentIndex = (
        1 +
            (if (state.error != null) 1 else 0) +
            (if (state.sendNotice != null) 1 else 0) +
            (if (messages.isEmpty()) 1 else messages.size) +
            (if (agentThinking) 1 else 0)
            + (if (submissionLabel != null) 1 else 0)
        ) - 1
    // Re-entering a chat must position its current content again.
    val displayThreadId = state.selectedThreadId ?: state.sendingDraft?.requestId ?: "new-chat"
    // The reader's intent, not post-layout geometry: only a user scroll can change it (or the jump button).
    var followLatest by remember(displayThreadId) { mutableStateOf(true) }
    val programmaticScroll = remember { booleanArrayOf(false) }
    LaunchedEffect(displayThreadId) {
        var userScroll = false
        var wasScrolling = false
        snapshotFlow { listState.isScrollInProgress }.collect { scrolling ->
            if (scrolling && !wasScrolling) userScroll = !programmaticScroll[0]
            if (!scrolling && wasScrolling && userScroll) {
                val info = listState.layoutInfo
                val last = info.visibleItemsInfo.lastOrNull()
                val atBottom = last == null || (last.index >= info.totalItemsCount - 1 &&
                    last.offset + last.size <= info.viewportEndOffset - info.afterContentPadding + CHAT_BOTTOM_TOLERANCE_PX)
                followLatest = nextFollowLatest(followLatest, userScrollEnded = true, atBottom = atBottom, tappedNewest = false)
            }
            wasScrolling = scrolling
        }
    }
    // Decide synchronously and queue the scroll for the very measure pass that lays out the new
    // content, so no frame is ever drawn at the stale offset. A large offset on the last item is
    // clamped by the list to the end of the content (single step, snapping, no animation).
    val followState = remember { ChatFollowMemory() }
    if (followState.threadId != displayThreadId) {
        followState.threadId = displayThreadId
        followState.previous = null
        followState.positioned = false
    }
    val shouldFollow = shouldFollowChatRevision(
        firstPosition = !followState.positioned,
        nearLatest = followLatest,
        previous = followState.previous,
        current = followRevision,
    )
    followState.previous = followRevision
    if (shouldFollow && lastContentIndex >= 0) {
        listState.requestScrollToItem(lastContentIndex, CHAT_SCROLL_TO_END_OFFSET)
        followState.positioned = true
    }

    Box(Modifier.fillMaxSize().background(Aw.Bg)) {
        AwLazyColumn(state = listState, topPadding = 30.dp, bottomPadding = if (hasActionablePermission) 40.dp else 72.dp, spacing = 0.dp) {
            item(key = "header") {
                Column(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        chat?.title ?: state.selectedSession?.title ?: "Codex chat",
                        style = AwType.Title.copy(fontSize = 13.5.sp),
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = 8.dp),
                    )
                    Spacer(Modifier.height(3.dp))
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        when {
                            hasPendingPermission -> { StatusIndicator(StatusKind.Attention); Text("Needs approval", color = Aw.Attention, fontSize = 11.sp) }
                            submissionLabel != null -> Text(submissionLabel, style = AwType.Caption, textAlign = TextAlign.Center)
                            state.pending && chat == null -> { StatusIndicator(StatusKind.Working); ShimmerText("Loading recent replies", fontSize = 11.sp) }
                            chat?.status == SessionStatus.ACTIVE -> { StatusIndicator(StatusKind.Working); ShimmerText("Working", fontSize = 11.sp) }
                            chat?.status == SessionStatus.ERROR -> { StatusIndicator(StatusKind.Error); Text("Needs attention", color = Aw.ErrorText, fontSize = 11.sp) }
                            chat?.status == SessionStatus.NOT_LOADED -> { StatusIndicator(StatusKind.Attention); Text("Not connected", style = AwType.Caption) }
                            chat != null -> { StatusIndicator(StatusKind.Ready); Text("Ready", style = AwType.Caption) }
                            else -> Text("Waiting for the private bridge", style = AwType.Caption)
                        }
                    }
                }
            }
            state.error?.let { message ->
                item(key = "error") { Box(Modifier.padding(bottom = 10.dp)) { InlineError(message, state.showErrorDetails) } }
            }
            state.sendNotice?.let { message ->
                item(key = "notice") {
                    Text(
                        message,
                        style = AwType.Caption.copy(color = Aw.Text),
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 10.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(Aw.Surface)
                            .padding(horizontal = 10.dp, vertical = 8.dp),
                    )
                }
            }
            if (messages.isEmpty()) {
                item(key = "empty") {
                    Column(Modifier.fillMaxWidth().padding(vertical = 18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("No conversation yet", style = AwType.Row)
                        Spacer(Modifier.height(4.dp))
                        Text("Tap Reply to start or continue this chat.", style = AwType.Caption, textAlign = TextAlign.Center)
                    }
                }
            } else {
                itemsIndexed(messages, key = { _, m -> m.id }) { index, message ->
                    val next = messages.getOrNull(index + 1)
                    val sameCluster = next != null && next.turnId == message.turnId && next.role == message.role && next.kind == message.kind
                    ChatMessageItem(
                        message = message,
                        feedback = state.chatFeedback[message.id],
                        feedbackPending = state.feedbackPendingMessageId == message.id,
                        feedbackEnabled = state.feedbackPendingMessageId == null,
                        collapseUpdates = state.collapseUpdates,
                        approvalMode = state.approvalMode,
                        permissionPending = state.pending,
                        onRateMessage = onRateMessage,
                        onPermissionResponse = onPermissionResponse,
                        questionsOpen = message.needsAnswer && !message.isAnsweredLocally(state.answeredQuestionItems) && !state.pending,
                        onAnswerQuestion = onAnswerQuestion,
                        onReplyToQuestion = onReplyToQuestion,
                        modifier = Modifier.padding(bottom = if (sameCluster) 4.dp else 11.dp),
                    )
                }
            }
            if (agentThinking) {
                item(key = "agent-thinking") { ThinkingRow(palette, Modifier.padding(bottom = 11.dp)) }
            }
            submissionLabel?.let { label ->
                item(key = "submission-status") {
                    Row(Modifier.fillMaxWidth().padding(bottom = 11.dp).semantics { liveRegion = LiveRegionMode.Polite },
                        horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
                        StatusIndicator(when (submission?.phase) {
                            SubmissionPhase.SENDING, SubmissionPhase.ACCEPTED, SubmissionPhase.RUNNING -> StatusKind.Working
                            SubmissionPhase.COMPLETED -> StatusKind.Ready
                            SubmissionPhase.FAILED -> StatusKind.Error
                            else -> StatusKind.Attention
                        })
                        Text(label, style = AwType.Caption, modifier = Modifier.weight(1f, fill = false))
                        if (submission != null && (submission.phase == SubmissionPhase.FAILED || submission.phase == SubmissionPhase.UNCERTAIN)) {
                            // 48 dp touch target around the 28 dp visual pill.
                            Box(
                                Modifier.heightIn(min = 48.dp).clickable(role = Role.Button) { onDismissSubmission(submission.requestId) },
                                contentAlignment = Alignment.Center,
                            ) {
                                AwPillButton("Dismiss", { onDismissSubmission(submission.requestId) }, height = 28.dp)
                            }
                        }
                    }
                }
            }
        }

        AnimatedVisibility(
            visible = !followLatest,
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = if (hasActionablePermission) 14.dp else 60.dp),
            enter = fadeIn(tween(220)) + slideInVertically(tween(260, easing = AwEase)) { it / 3 },
            exit = fadeOut(tween(160)),
        ) {
            AwCircleButton(Icons.Rounded.KeyboardArrowDown, "Jump to latest message", onClick = {
                followLatest = nextFollowLatest(followLatest, userScrollEnded = false, atBottom = false, tappedNewest = true)
                scope.launch {
                    programmaticScroll[0] = true
                    try {
                        listState.scrollChatToBottom(listState.layoutInfo.totalItemsCount - 1, animated = ValueAnimator.areAnimatorsEnabled())
                    } finally { programmaticScroll[0] = false }
                }
            }, size = 34.dp)
        }

        if (!hasActionablePermission) {
            val retrying = state.error != null
            val checkDelivery = canCheckDeliveryHere(state.canCheckTurnConfirmation, state.pendingTurnThreadId, state.selectedThreadId) || submission?.phase == SubmissionPhase.UNCERTAIN
            val reviewFailed = submission?.phase == SubmissionPhase.FAILED
            AwEdgeButton(
                label = if (checkDelivery) "Check status" else if (reviewFailed) "Review message" else if (retrying) "Retry" else "Reply",
                icon = if (retrying) Icons.Rounded.Refresh else Icons.Rounded.Mic,
                enabled = !state.pending,
                onClick = if (retrying || checkDelivery || reviewFailed) onRetry else onReply,
            )
        }
    }
}

internal data class ChatFollowRevision(
    val messages: List<ChatMessage>,
    val agentThinking: Boolean,
    val error: String?,
    val sendNotice: String?,
    val submissionStatus: String? = null,
)

internal const val CHAT_BOTTOM_TOLERANCE_PX = 24
private const val CHAT_SCROLL_TO_END_OFFSET = 1_000_000

private class ChatFollowMemory {
    var threadId: String? = null
    var previous: ChatFollowRevision? = null
    var positioned = false
}

/** Reader intent: a finished user scroll sets it from the bottom position; the jump button sets it. */
internal fun nextFollowLatest(current: Boolean, userScrollEnded: Boolean, atBottom: Boolean, tappedNewest: Boolean): Boolean =
    if (tappedNewest) true else if (userScrollEnded) atBottom else current

/** [nearLatest] is the reader's follow intent ([nextFollowLatest]), not measured geometry. */
internal fun shouldFollowChatRevision(
    firstPosition: Boolean,
    nearLatest: Boolean,
    previous: ChatFollowRevision?,
    current: ChatFollowRevision,
): Boolean = firstPosition || (previous != current && nearLatest)

private suspend fun LazyListState.scrollChatToBottom(lastContentIndex: Int, animated: Boolean) {
    if (lastContentIndex < 0) return
    // Automatic following intentionally snaps: streaming deltas can arrive
    // faster than an animation finishes and repeatedly cancel its final step.
    if (animated) animateScrollToItem(lastContentIndex) else scrollToItem(lastContentIndex)
    val layout = layoutInfo
    val target = layout.visibleItemsInfo.firstOrNull { it.index == lastContentIndex } ?: return
    val remaining = (target.offset + target.size + layout.afterContentPadding - layout.viewportEndOffset).coerceAtLeast(0)
    if (remaining > 0) scrollBy(remaining.toFloat())
}

@Composable
private fun ThinkingRow(palette: OrbPalette, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 2.dp)
            .semantics { stateDescription = "Agent is thinking"; liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        CloudOrb(palette, OrbMode.Thinking, 0f, 0f, Modifier.size(16.dp))
        ShimmerText("Thinking", fontSize = 12.5.sp)
    }
}

@Composable
private fun ChatMessageItem(
    message: ChatMessage,
    feedback: FeedbackRating?,
    feedbackPending: Boolean,
    feedbackEnabled: Boolean,
    collapseUpdates: Boolean,
    approvalMode: ApprovalMode,
    permissionPending: Boolean,
    onRateMessage: (ChatMessage, FeedbackRating) -> Unit,
    onPermissionResponse: (ChatMessage, Boolean) -> Unit,
    questionsOpen: Boolean,
    onAnswerQuestion: (ChatMessage, String) -> Unit,
    onReplyToQuestion: (ChatMessage) -> Unit,
    modifier: Modifier = Modifier,
) {
    when {
        message.kind == ChatMessageKind.PERMISSION -> PermissionCard(message, approvalMode, permissionPending, onPermissionResponse, modifier)
        message.role == ChatRole.USER -> UserBubble(message, modifier)
        message.phase == ChatPhase.COMMENTARY -> UpdateRow(message, collapseUpdates, modifier)
        else -> AnswerBlock(message, feedback, feedbackPending, feedbackEnabled, onRateMessage, questionsOpen, onAnswerQuestion, onReplyToQuestion, modifier)
    }
}

@Composable
private fun UserBubble(message: ChatMessage, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Box(
            Modifier
                .fillMaxWidth(0.88f)
                .wrapContentWidth(Alignment.End)
                .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomEnd = 5.dp, bottomStart = 16.dp))
                .background(Aw.SurfaceHigh)
                .padding(horizontal = 11.dp, vertical = 7.dp)
                .semantics(mergeDescendants = true) { contentDescription = "You said: ${message.text}" },
        ) {
            MarkdownMessageText(message.text, color = Aw.Text, accent = Aw.Text, codeBackground = Aw.SurfaceRaised,
                fontSize = 12.5.sp, lineHeight = 17.sp)
        }
    }
}

/** Intermediate agent updates: a quiet, collapsible line like Codex's work log. */
@Composable
private fun UpdateRow(message: ChatMessage, collapseUpdates: Boolean, modifier: Modifier = Modifier) {
    var collapsed by rememberSaveable(message.id, collapseUpdates) { mutableStateOf(ChatDisplayPolicy.startsCollapsed(message, collapseUpdates)) }
    val haptics = LocalHapticFeedback.current
    val rotation by animateFloatAsState(if (collapsed) 0f else 90f, tween(220), label = "update chevron")
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable(role = Role.Button) {
                haptics.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
                collapsed = !collapsed
            }
            .padding(horizontal = 2.dp, vertical = 3.dp)
            .semantics { stateDescription = if (collapsed) "Collapsed update" else "Expanded update" },
    ) {
        AnimatedContent(
            targetState = collapsed,
            transitionSpec = {
                (fadeIn(tween(200)) togetherWith fadeOut(tween(120))).using(SizeTransform(clip = true) { _, _ -> tween(220, easing = AwEase) })
            },
            label = "update body",
        ) { isCollapsed ->
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Icon(
                    Icons.Rounded.ChevronRight, contentDescription = null, tint = Aw.TextTertiary,
                    modifier = Modifier.padding(top = 1.dp).size(14.dp).graphicsLayer { rotationZ = rotation },
                )
                MarkdownMessageText(
                    message.text,
                    color = Aw.TextSecondary,
                    accent = Aw.TextSecondary,
                    codeBackground = Aw.Surface,
                    fontSize = 11.5.sp,
                    lineHeight = 15.sp,
                    maxLines = if (isCollapsed) 1 else Int.MAX_VALUE,
                    overflow = if (isCollapsed) TextOverflow.Ellipsis else TextOverflow.Clip,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun AnswerBlock(
    message: ChatMessage,
    feedback: FeedbackRating?,
    feedbackPending: Boolean,
    feedbackEnabled: Boolean,
    onRateMessage: (ChatMessage, FeedbackRating) -> Unit,
    questionsOpen: Boolean,
    onAnswerQuestion: (ChatMessage, String) -> Unit,
    onReplyToQuestion: (ChatMessage) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth().padding(horizontal = 2.dp)) {
        MarkdownMessageText(message.text, color = Color3.AnswerText, accent = Aw.Text, codeBackground = Aw.SurfaceRaised,
            fontSize = 12.5.sp, lineHeight = 18.sp, modifier = Modifier.fillMaxWidth())
        if (questionsOpen) QuestionChoices(message, onAnswerQuestion, onReplyToQuestion)
        Row(
            Modifier.offset(x = (-8).dp).semantics { if (feedbackPending) stateDescription = "Sending feedback" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FeedbackButton(FeedbackRating.LIKED, feedback == FeedbackRating.LIKED, feedbackPending, feedbackEnabled) { onRateMessage(message, FeedbackRating.LIKED) }
            FeedbackButton(FeedbackRating.DISLIKED, feedback == FeedbackRating.DISLIKED, feedbackPending, feedbackEnabled) { onRateMessage(message, FeedbackRating.DISLIKED) }
            if (feedbackPending) ShimmerText("Sending", fontSize = 10.sp)
        }
    }
}

/** Question title, one full-width chip per option (max 4) and a Reply chip for a free-text answer. */
@Composable
private fun QuestionChoices(
    message: ChatMessage,
    onAnswer: (ChatMessage, String) -> Unit,
    onReply: (ChatMessage) -> Unit,
) {
    val question = message.questions.firstOrNull() ?: return
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        MarkdownMessageText(question.title, color = Aw.Text, accent = Aw.Text, codeBackground = Aw.SurfaceRaised,
            fontSize = 12.5.sp, lineHeight = 17.sp, modifier = Modifier.fillMaxWidth().padding(bottom = 2.dp))
        question.options.take(MAX_QUESTION_OPTIONS).forEach { option ->
            QuestionChip(option, primary = false) { onAnswer(message, option) }
        }
        QuestionChip("Reply", primary = question.options.isEmpty()) { onReply(message) }
    }
}

@Composable
private fun QuestionChip(label: String, primary: Boolean, onClick: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 40.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(if (primary) Aw.Text else Aw.SurfaceHigh)
            .clickable(role = Role.Button) {
                haptics.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
                onClick()
            }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (primary) Aw.OnPrimary else Aw.Text,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private object Color3 {
    val AnswerText = androidx.compose.ui.graphics.Color(0xFFECECEC)
}

@Composable
private fun FeedbackButton(rating: FeedbackRating, selected: Boolean, pending: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val interactive = enabled && !pending
    val liked = rating == FeedbackRating.LIKED
    val haptics = LocalHapticFeedback.current
    Box(
        Modifier
            .size(48.dp)
            .clickable(enabled = interactive, role = Role.Button, interactionSource = remember { MutableInteractionSource() }, indication = null) {
                haptics.performHapticFeedback(HapticFeedbackType.ToggleOn); onClick()
            }
            .semantics {
                this.selected = selected
                contentDescription = if (liked) "Like this Codex response" else "Dislike this Codex response"
                stateDescription = when { pending -> "Feedback sending"; selected -> "Selected"; else -> "Not selected" }
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(30.dp).clip(CircleShape).background(if (selected) Aw.SurfaceRaised else androidx.compose.ui.graphics.Color.Transparent),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (liked) Icons.Rounded.ThumbUp else Icons.Rounded.ThumbDown, contentDescription = null,
                tint = if (selected) Aw.Text else Aw.TextTertiary,
                modifier = Modifier.size(14.dp).graphicsLayer { alpha = if (interactive || selected) 1f else .5f },
            )
        }
    }
}

@Composable
private fun PermissionCard(
    message: ChatMessage,
    approvalMode: ApprovalMode,
    pending: Boolean,
    onPermissionResponse: (ChatMessage, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val canRespond = message.canControl && !message.resolved && approvalMode == ApprovalMode.ALLOW_CONTROLS
    val stateLabel = when {
        message.resolved -> "Resolved"
        pending && canRespond -> "Sending…"
        canRespond -> "Approval needed"
        else -> "Permission requested"
    }
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Aw.Surface)
            .border(1.dp, if (message.resolved) Aw.Line else Aw.Attention.copy(alpha = .38f), shape)
            .semantics {
                stateDescription = stateLabel
                contentDescription = permissionRequestContentDescription(stateLabel, message.text)
            }
            .padding(horizontal = 11.dp, vertical = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Icon(
                if (message.resolved) Icons.Rounded.Check else Icons.Rounded.Security, contentDescription = null,
                tint = if (message.resolved) Aw.ReadyText else Aw.Attention, modifier = Modifier.size(14.dp),
            )
            Text(stateLabel, color = if (message.resolved) Aw.ReadyText else Aw.Attention, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(5.dp))
        MarkdownMessageText(message.text, color = Aw.Text, accent = Aw.Text, codeBackground = Aw.SurfaceRaised, fontSize = 12.sp, lineHeight = 16.5.sp)
        when {
            canRespond -> {
                Spacer(Modifier.height(9.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    AwPillButton("Decline", { onPermissionResponse(message, false) }, enabled = !pending, modifier = Modifier.weight(1f))
                    AwPillButton("Allow", { onPermissionResponse(message, true) }, primary = true, enabled = !pending, modifier = Modifier.weight(1f))
                }
                Spacer(Modifier.height(5.dp))
                Text("This turn only", style = AwType.Micro, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            }
            !message.resolved -> {
                Spacer(Modifier.height(6.dp))
                Text(
                    if (message.canControl) "Alert only · decide in Codex, or allow watch controls in Settings" else "Decide in Codex on your Mac",
                    style = AwType.Micro, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
