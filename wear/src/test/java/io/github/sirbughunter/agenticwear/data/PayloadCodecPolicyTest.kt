package io.github.sirbughunter.agenticwear.data

import io.github.sirbughunter.agenticwear.model.ModelOption
import io.github.sirbughunter.agenticwear.model.ReasoningEffortPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
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

    @Test
    fun `reasoning effort values normalize to safe labels`() {
        assertEquals("xhigh", ReasoningEffortPolicy.normalize(" XHIGH "))
        assertEquals("medium", ReasoningEffortPolicy.normalize("not supported"))
        assertEquals("Extra high", ReasoningEffortPolicy.label("xhigh"))
    }

    @Test
    fun `model catalog keeps advertised reasoning options`() {
        val model = ModelOption("gpt-5.6-terra", "GPT-5.6-Terra", "gpt-5.6-terra", "high", listOf("low", "high"))
        assertEquals(
            listOf("low", "high"),
            ReasoningEffortPolicy.options(model),
        )
        assertEquals(listOf("low", "medium", "high", "xhigh"), ReasoningEffortPolicy.FALLBACK_OPTIONS)
    }
}
