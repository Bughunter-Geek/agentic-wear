package io.github.sirbughunter.agenticwear.live

import org.junit.Assert.*
import org.junit.Test

class NativeVoiceReadinessTest {
    @Test fun connectedMediaKeepsDotInputMutedUntilAttachment() {
        val gate = NativeVoiceReadiness(); gate.configure(true); gate.connected(true)
        assertFalse(gate.ready); assertTrue(gate.effectiveMute(false))
        gate.accepted()
        assertTrue(gate.ready); assertFalse(gate.effectiveMute(false)); assertTrue(gate.effectiveMute(true))
    }
    @Test fun attachmentBeforeMediaCannotMakeTheCallLive() {
        val gate = NativeVoiceReadiness(); gate.configure(true); gate.accepted()
        assertFalse(gate.ready)
        gate.connected(true); assertTrue(gate.ready)
        gate.connected(false); assertFalse(gate.ready)
    }
    @Test fun localVoiceKeepsItsExistingConnectivityGate() {
        val gate = NativeVoiceReadiness(); gate.configure(false)
        assertFalse(gate.ready); gate.connected(true); assertTrue(gate.ready)
    }
}
