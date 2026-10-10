package io.github.sirbughunter.agenticwear.live

import org.junit.Assert.*
import org.junit.Test

class VoiceTraceWindowTest {
    @Test fun hashesIdentifiersAndRejectsArbitraryState() {
        val event = VoiceTraceWindow({ 10L }, "private-call", "private-task")
            .event(VoiceTraceStage.OFFER_READY, "secret transcript / credential", 3)!!
        assertEquals(setOf("stage", "elapsedMs", "callHash", "threadHash", "count"), event.keys)
        assertEquals(12, (event["callHash"] as String).length)
        assertFalse(event.toString().contains("private")); assertFalse(event.toString().contains("secret"))
    }
    @Test fun finiteWindowAndRecordBudget() {
        var now = 0L
        val window = VoiceTraceWindow({ now }, "call", "task")
        repeat(80) { assertNotNull(window.event(VoiceTraceStage.ICE_STATE, "NEW")) }
        assertNull(window.event(VoiceTraceStage.ICE_STATE))
        val expired = VoiceTraceWindow({ now }, "call", "task"); now = 90_001
        assertNull(expired.event(VoiceTraceStage.END))
    }
    @Test fun preservesOrderTimingAndSafeCandidateCount() {
        var now = 100L
        val window = VoiceTraceWindow({ now }, "call", "task")
        val first = window.event(VoiceTraceStage.OFFER_BEGIN)!!; now = 450
        val last = window.event(VoiceTraceStage.OFFER_NO_CANDIDATE, count = 0)!!
        assertEquals(first["callHash"], last["callHash"]); assertEquals(350L, last["elapsedMs"])
        assertEquals(0, last["count"])
    }
    @Test fun recordsNetworkLabelsForTheBridgeTraceOnly() {
        val window = VoiceTraceWindow({ 5L }, "call", "task")
        window.event(VoiceTraceStage.NETWORK_REQUEST, "BLUETOOTH")
        window.event(VoiceTraceStage.NETWORK_READY, "WIFI")
        window.event(VoiceTraceStage.NETWORK_READY, "BLUETOOTH_TIMEOUT")
        window.event(VoiceTraceStage.NETWORK_READY, "wlan0 192.168.1.4")
        val events = window.events()
        assertEquals(listOf("BLUETOOTH", "WIFI", "BLUETOOTH_TIMEOUT", null), events.map { it["state"] })
        assertTrue(events.all { it.keys.all { key -> key in setOf("stage", "elapsedMs", "callHash", "threadHash", "state", "count") } })
    }
}
