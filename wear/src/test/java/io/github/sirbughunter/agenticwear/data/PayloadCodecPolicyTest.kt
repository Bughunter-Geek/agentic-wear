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
}
