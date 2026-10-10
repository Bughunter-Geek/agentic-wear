package io.github.sirbughunter.agenticwear.ui

import io.github.sirbughunter.agenticwear.model.AgentAlert
import io.github.sirbughunter.agenticwear.model.AlertKind
import io.github.sirbughunter.agenticwear.model.ApprovalMode

internal fun canRespondToAlert(alert: AgentAlert?, mode: ApprovalMode, readOnly: Boolean): Boolean =
    !readOnly && mode == ApprovalMode.ALLOW_CONTROLS && alert?.kind == AlertKind.PERMISSION &&
        alert.canControl && !alert.approvalId.isNullOrBlank()
