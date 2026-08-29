package io.github.sirbughunter.agenticwear.data

import io.github.sirbughunter.agenticwear.model.ModelOption
import io.github.sirbughunter.agenticwear.model.ChatDisplayPolicy
import io.github.sirbughunter.agenticwear.model.ChatMessage
import io.github.sirbughunter.agenticwear.model.ChatMessageKind
import io.github.sirbughunter.agenticwear.model.ChatPhase
import io.github.sirbughunter.agenticwear.model.ChatRole
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
    fun `long safe request errors survive decoding without presentation truncation`() {
        val detail = "The complete safe bridge diagnostic remains available. " + "detail ".repeat(120)
        assertEquals(detail.trim(), fullAlertDetail(detail))
    }

    @Test
    fun `reasoning effort values normalize to safe labels`() {
        assertEquals("xhigh", ReasoningEffortPolicy.normalize(" XHIGH "))
        assertEquals("medium", ReasoningEffortPolicy.normalize("not supported"))
        assertEquals("Extra High", ReasoningEffortPolicy.label("xhigh"))
        assertEquals("Ultra", ReasoningEffortPolicy.label("ultra"))
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

    @Test
    fun `changing model always selects that model's advertised default effort`() {
        val model = ModelOption(
            "gpt-5.6-sol",
            "GPT-5.6-Sol",
            "gpt-5.6-sol",
            "high",
            listOf("low", "high", "max"),
        )

        assertEquals("high", ReasoningEffortPolicy.defaultFor(model))
        assertEquals("medium", ReasoningEffortPolicy.defaultFor(null))
        assertEquals(
            "low",
            ReasoningEffortPolicy.defaultFor(model.copy(defaultReasoningEffort = "unsupported value")),
        )
    }

    @Test
    fun `only ordinary assistant updates auto-collapse`() {
        val update = ChatMessage(
            id = "message-1",
            turnId = "turn-1",
            role = ChatRole.ASSISTANT,
            text = "Working",
            phase = ChatPhase.COMMENTARY,
        )

        assertTrue(ChatDisplayPolicy.startsCollapsed(update, collapseUpdates = true))
        assertFalse(ChatDisplayPolicy.startsCollapsed(update, collapseUpdates = false))
        assertFalse(ChatDisplayPolicy.startsCollapsed(update.copy(phase = ChatPhase.FINAL_ANSWER), true))
        assertFalse(ChatDisplayPolicy.startsCollapsed(update.copy(role = ChatRole.USER), true))
        assertFalse(ChatDisplayPolicy.startsCollapsed(update.copy(kind = ChatMessageKind.PERMISSION), true))
    }
}
