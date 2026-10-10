package io.github.sirbughunter.agenticwear.ui

import io.github.sirbughunter.agenticwear.live.LiveVoiceState
import io.github.sirbughunter.agenticwear.live.activityLabel
import io.github.sirbughunter.agenticwear.live.taskToOpen
import io.github.sirbughunter.agenticwear.live.decisionRequestId
import io.github.sirbughunter.agenticwear.live.observedMediaLevel
import io.github.sirbughunter.agenticwear.live.orbScaleTarget
import io.github.sirbughunter.agenticwear.live.withConnection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveVoicePresentationTest {
    @Test fun decisionsRequireTheCurrentLiveApprovalAndCannotBeRepeatedWhileSending() {
        val pending = LiveVoiceState(phase = "live", taskPhase = "approval", approvalId = "request-a", canApprove = true)
        assertEquals("request-a", pending.decisionRequestId())
        assertNull(pending.copy(phase = "reconnecting").decisionRequestId())
        assertNull(pending.withConnection(false).withConnection(true).decisionRequestId())
        assertNull(pending.copy(taskPhase = "completed").decisionRequestId())
        assertNull(pending.copy(canApprove = false).decisionRequestId())
        assertNull(pending.copy(deciding = true).decisionRequestId())
        assertNull(pending.copy(approvalId = null).decisionRequestId())
        assertEquals("request-b", pending.copy(approvalId = "request-b").decisionRequestId())
    }
    @Test fun realInputExpandsAndPausesSettleWithoutFalseMutedOrInactiveInput() {
        val listening = LiveVoiceState(phase = "live", inputLevel = .7f)
        assertTrue(listening.orbScaleTarget(false) > 1f)
        assertEquals(1f, listening.copy(inputLevel = 0f).orbScaleTarget(false))
        assertEquals(1f, listening.copy(inputLevel = .01f).orbScaleTarget(false))
        assertEquals(1f, listening.copy(muted = true).orbScaleTarget(false))
        assertEquals(1f, listening.copy(phase = "idle").orbScaleTarget(false))
        assertEquals(1f, listening.copy(approvalId = "request").orbScaleTarget(false))
        assertEquals(1f, listening.orbScaleTarget(true))
        assertEquals(0f, listening.copy(inputLevel = Float.NaN).observedMediaLevel())
        assertTrue(listening.copy(muted = true, outputLevel = .7f).orbScaleTarget(false) > 1f)
    }
    @Test fun changingSelectionCannotRetargetAnActiveVoiceTask() {
        assertEquals("active-task", LiveVoiceState(phase = "live", taskId = "active-task").taskToOpen("new-selection"))
        assertEquals("new-selection", LiveVoiceState().taskToOpen("new-selection"))
    }
    @Test fun permissionWaitNeverAppearsAsThinkingOrSpeaking() {
        val state = LiveVoiceState(phase = "live", taskPhase = "working", mediaActivity = "speaking", approvalId = "permission")
        assertEquals("Permission needed", state.activityLabel())
    }
    @Test fun levelsAndMuteReflectActualMedia() {
        assertEquals("Listening", LiveVoiceState(phase = "live", inputLevel = 0.2f).activityLabel())
        assertEquals("Microphone muted", LiveVoiceState(phase = "live", inputLevel = 0.2f, muted = true).activityLabel())
        assertEquals("Speaking", LiveVoiceState(phase = "live", outputLevel = 0.2f, muted = true).activityLabel())
    }
    @Test fun idleAndCompletedTasksDoNotInventWork() {
        assertEquals("Ready to listen", LiveVoiceState(phase = "live", taskPhase = "completed").activityLabel())
        assertEquals("Running a command", LiveVoiceState(phase = "live", taskPhase = "working", taskDetail = "Running a command").activityLabel())
        assertEquals("Connection interrupted", LiveVoiceState(phase = "connecting", detail = "Connection interrupted").activityLabel())
    }
}
