package io.github.sirbughunter.agenticwear.ui

internal const val DetailOverlayMotionDurationMillis = 200

enum class ErrorRecoveryAction {
    REFRESH_SESSIONS,
    START_NEW_SESSION,
}

data class ErrorDetailPresentation(
    val compactLabel: String,
    val fullText: String,
    val contentDescription: String,
)

internal fun errorDetailPresentation(message: String): ErrorDetailPresentation {
    val displayMessage = if (message.contains("Keystore operation failed", ignoreCase = true) ||
        message.contains("KeyStoreException", ignoreCase = true)
    ) {
        "Watch security hardware was temporarily busy. Tap Retry."
    } else {
        message
    }
    val separator = if (displayMessage.trimEnd().lastOrNull() in setOf('.', '!', '?')) " " else ". "
    return ErrorDetailPresentation(
        compactLabel = "Error — tap for details",
        fullText = displayMessage,
        contentDescription = "Error: $displayMessage${separator}Tap for full details.",
    )
}

internal fun detailScrollAffordance(hasMoreContent: Boolean): String? =
    if (hasMoreContent) "Swipe to read more ↓" else null

internal fun permissionRequestContentDescription(stateLabel: String, messageText: String): String =
    "Permission request. $stateLabel. $messageText"

internal fun recoveryActionsForError(message: String?): Set<ErrorRecoveryAction> {
    if (message.isNullOrBlank()) return emptySet()
    if (
        Regex(
            "active writer|actively writing this session|active session in another client|" +
                "session is (currently )?active in another client|owns this session in another client|" +
                "another Codex client|session is busy|does not support queued watch prompts|" +
                "could not synchronize this session|synchronize this session|Keystore operation failed|" +
                "security hardware was temporarily busy",
            RegexOption.IGNORE_CASE,
        ).containsMatchIn(message)
    ) {
        return setOf(ErrorRecoveryAction.REFRESH_SESSIONS, ErrorRecoveryAction.START_NEW_SESSION)
    }
    return if (
        Regex("could not load this session|not synced|no longer available", RegexOption.IGNORE_CASE)
            .containsMatchIn(message)
    ) setOf(ErrorRecoveryAction.REFRESH_SESSIONS) else emptySet()
}

internal fun recoverDraftForNewSession(state: WearUiState): WearUiState {
    val draft = state.transcript ?: return state
    return state.copy(
        selectedThreadId = null,
        chat = null,
        transcript = draft.copy(threadId = null),
        error = null,
        submitDraftAsNewSession = true,
    )
}

internal fun threadIdForDraftSubmission(state: WearUiState): String? {
    if (state.submitDraftAsNewSession) return null
    return state.transcript?.threadId ?: state.selectedThreadId
}

internal fun transcriptDestinationLabel(state: WearUiState): String = when {
    state.submitDraftAsNewSession -> "New session — created only when you send"
    else -> state.selectedSession?.title ?: "New session"
}
