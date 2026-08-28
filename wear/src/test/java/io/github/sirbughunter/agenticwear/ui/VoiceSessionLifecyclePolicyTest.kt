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
    fun activityBoundDeviceSpeechStopsWithActivity() {
        assertTrue(shouldCancelRecordingWhenActivityStops(TranscriptionEngine.DEVICE_SPEECH))
    }
}
