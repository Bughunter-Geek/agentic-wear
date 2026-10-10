package io.github.sirbughunter.agenticwear.ui

import io.github.sirbughunter.agenticwear.model.TranscriptionEngine
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceSessionLifecyclePolicyTest {
    @Test
    fun bridgeRecordingSurvivesActivityStop() {
        assertFalse(shouldCancelRecordingWhenActivityStops(TranscriptionEngine.BRIDGE_WHISPER))
    }

    @Test
    fun phononRecordingSurvivesActivityStop() {
        assertFalse(shouldCancelRecordingWhenActivityStops(TranscriptionEngine.BRIDGE_PHONON))
    }

    @Test
    fun explicitBridgeChoicesRouteToTheirNamedBackend() {
        org.junit.Assert.assertEquals("phonon", TranscriptionEngine.BRIDGE_PHONON.bridgeBackend)
        org.junit.Assert.assertEquals("whisper", TranscriptionEngine.BRIDGE_WHISPER.bridgeBackend)
        org.junit.Assert.assertNull(TranscriptionEngine.DEVICE_SPEECH.bridgeBackend)
    }

    @Test
    fun activityBoundDeviceSpeechStopsWithActivity() {
        assertTrue(shouldCancelRecordingWhenActivityStops(TranscriptionEngine.DEVICE_SPEECH))
    }
}
