package io.github.sirbughunter.agenticwear.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PayloadCodecPolicyTest {
    @Test
    fun `completion requires an explicit top-level turn scope`() {
        assertTrue(acceptsAlertEnvelope("terminal.completed", "topLevel"))
        assertFalse(acceptsAlertEnvelope("terminal.completed", ""))
        assertFalse(acceptsAlertEnvelope("terminal.completed", "nested"))
    }

    @Test
    fun `permission alerts remain independent of turn completion scope`() {
        assertTrue(acceptsAlertEnvelope("approval.request", ""))
    }

    @Test
    fun `request failures are explicit red alert kinds`() {
        assertTrue(isRequestErrorKind("transcription.error"))
        assertTrue(isRequestErrorKind("turn.error"))
        assertTrue(isRequestErrorKind("approval.error"))
        assertTrue(isRequestErrorKind("bridge.error"))
        assertFalse(isRequestErrorKind("chat.error"))
        assertFalse(isRequestErrorKind("turn.accepted"))
        assertFalse(isRequestErrorKind("item.completed"))
    }
}
