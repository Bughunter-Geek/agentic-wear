package io.github.sirbughunter.agenticwear.ui

import io.github.sirbughunter.agenticwear.model.*
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertDecisionPolicyTest {
    private val request = AgentAlert("event", AlertKind.PERMISSION, "task", "Task", "Read folder?", 1,
        "native-request", true)

    @Test fun historyIsReadOnlyEvenIfItsStoredEventOnceAllowedControls() {
        assertFalse(canRespondToAlert(request, ApprovalMode.ALLOW_CONTROLS, true))
        assertTrue(canRespondToAlert(request, ApprovalMode.ALLOW_CONTROLS, false))
    }
    @Test fun alertOnlyModeAndResolvedOrMissingRequestsCannotGrantPermissions() {
        assertFalse(canRespondToAlert(request, ApprovalMode.ALERT_ONLY, false))
        assertFalse(canRespondToAlert(request.copy(canControl = false), ApprovalMode.ALLOW_CONTROLS, false))
        assertFalse(canRespondToAlert(request.copy(approvalId = null), ApprovalMode.ALLOW_CONTROLS, false))
        assertFalse(canRespondToAlert(request.copy(kind = AlertKind.COMPLETE), ApprovalMode.ALLOW_CONTROLS, false))
    }
}
