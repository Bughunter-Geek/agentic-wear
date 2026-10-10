package io.github.sirbughunter.agenticwear.live

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceOrbMotionTest {
    @Test fun speakingKeepsTheSameRadiusAcrossLoudnessAndMicrophoneLeakage() {
        val samples = (0..100).map { level ->
            voiceOrbMotion(input = 1f, output = level / 100f, speaking = true, muted = false)
        }
        samples.forEach {
            assertEquals(VoiceOrbMode.SPEAKING, it.mode)
            assertEquals(1f, it.scale)
            assertTrue(it.frameIntervalMillis >= 50)
        }
        assertTrue(samples.last().flowSpeed > samples.first().flowSpeed)
        assertTrue(samples.last().fogStrength > samples.first().fogStrength)
    }

    @Test fun listeningIsGentleAndSettlesOnSilenceWithoutInventingAHeartbeat() {
        val loud = voiceOrbMotion(1f, 0f, false, false)
        assertEquals(VoiceOrbMode.LISTENING, loud.mode)
        assertEquals(1.12f, loud.scale, .00001f)
        val quiet = voiceOrbMotion(.02f, 0f, false, false)
        val reply = voiceOrbMotion(0f, 1f, true, false)
        assertTrue(loud.fogStrength > quiet.fogStrength)
        assertTrue(loud.flowSpeed > quiet.flowSpeed * 2f)
        assertTrue(loud.fogStrength < reply.fogStrength)
        assertTrue(loud.flowSpeed < reply.flowSpeed)
        assertTrue(loud.frameIntervalMillis >= 100)
        assertEquals(VoiceOrbMotion(), voiceOrbMotion(.01f, 0f, false, false))
        assertEquals(VoiceOrbMotion(), voiceOrbMotion(0f, 0f, false, false))
    }

    @Test fun cloudCoverageCanNearlyFillThenUncoverWithoutMotionFromSilence() {
        val coverage = (0..6000).map { voiceFogCoverage(1f, it / 50f) }
        assertTrue(coverage.max() > .99f)
        assertTrue(coverage.min() < .26f)
        // The spatial sweep is continuous even when the audio level is steady.
        assertTrue(coverage.zipWithNext().all { (a, b) -> kotlin.math.abs(a - b) < .008f })
        assertEquals(0f, voiceFogCoverage(0f, 4f))
        assertEquals(0f, voiceFogCoverage(Float.NaN, 4f))
        assertTrue(voiceFogCoverage(10f, Float.NaN) in 0f..1f)
        assertTrue(voiceFogCoverage(.56f, 4f) < voiceFogCoverage(1f, 4f))
    }

    @Test fun mutedMicrophoneCannotPulseButAudibleAssistantStillMovesItsFog() {
        assertEquals(VoiceOrbMotion(), voiceOrbMotion(1f, 0f, false, true))
        val reply = voiceOrbMotion(1f, .25f, false, true)
        assertEquals(VoiceOrbMode.SPEAKING, reply.mode)
        assertEquals(1f, reply.scale)
    }

    @Test fun unavailableReducedMotionAndHiddenSurfacesHaveNoAnimationClock() {
        assertEquals(VoiceOrbMotion(), voiceOrbMotion(1f, 1f, true, false, available = false))
        assertEquals(VoiceOrbMotion(), voiceOrbMotion(1f, 1f, true, false, reducedMotion = true))
        assertEquals(VoiceOrbMotion(), voiceOrbMotion(1f, 1f, true, false, visible = false))
    }

    @Test fun invalidLevelsAreSilentAndExcessiveLevelsCannotExpandBeyondTheReferenceRange() {
        assertEquals(VoiceOrbMotion(), voiceOrbMotion(Float.NaN, Float.POSITIVE_INFINITY, false, false))
        assertEquals(VoiceOrbMotion(), voiceOrbMotion(-10f, -1f, false, false))
        assertEquals(1.12f, voiceOrbMotion(40f, 0f, false, false).scale, .00001f)
        assertEquals(1f, voiceOrbMotion(40f, 40f, false, false).scale)
    }

    @Test fun energyFallbackUsesDeltaRmsAndDoesNotReplayOldEnergy() {
        val stats = VoiceAudioEnergy()
        assertEquals(0f, stats.sample(null, 5.0, 10.0))
        assertEquals(.5f, stats.sample(null, 5.25, 11.0), .00001f)
        assertEquals(0f, stats.sample(null, 5.25, 11.0))
        assertEquals(0f, stats.sample(null, 5.25, 12.0))
    }

    @Test fun validInstantaneousLevelsTakePriorityWhileTotalsStillEstablishABaseline() {
        val stats = VoiceAudioEnergy()
        assertEquals(.2f, stats.sample(.2, 1.0, 2.0))
        assertEquals(.5f, stats.sample(Double.NaN, 1.25, 3.0), .00001f)
        assertEquals(1f, stats.sample(7.0, null, null))
    }

    @Test fun resetMissingAndInvalidCountersNeverProduceAFakeEnergySpike() {
        val stats = VoiceAudioEnergy()
        stats.sample(null, 5.0, 10.0)
        assertEquals(0f, stats.sample(null, .1, 1.0))
        assertEquals(.5f, stats.sample(null, .35, 2.0), .00001f)
        assertEquals(0f, stats.sample(null, Double.POSITIVE_INFINITY, 3.0))
        assertEquals(0f, stats.sample(null, 100.0, 4.0))
        assertEquals(0f, stats.sample(null, null, null))
    }
}
