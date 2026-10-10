package io.github.sirbughunter.agenticwear.live

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class NewVoiceTaskStartTest {
    @Test fun oneTapCreatesSelectsAndConnectsExactTaskInOrder() = runBlocking {
        val trace = mutableListOf<String>()
        createAndConnectVoiceTask({ trace += "create"; CreatedVoiceTask("task-new", "Voice") }, { true },
            { trace += "select:${it.id}" }, { trace += "connect:${it.id}" })
        assertEquals(listOf("create", "select:task-new", "connect:task-new"), trace)
    }
    @Test fun canceledOrSupersededStartCannotOpenMediaOrChangeSelection() = runBlocking {
        var connect = false
        var select = false
        createAndConnectVoiceTask({ CreatedVoiceTask("old-task", "Voice") }, { false }, { select = true }, { connect = true })
        assertFalse(select); assertFalse(connect)
    }
    @Test fun cancellationDuringCreationReceivesAcknowledgmentButDoesNotConnect() = runBlocking {
        val creating = CompletableDeferred<Unit>()
        val finish = CompletableDeferred<Unit>()
        var acknowledged = false
        var connected = false
        val job = launch {
            createAndConnectVoiceTask({ creating.complete(Unit); finish.await(); acknowledged = true; CreatedVoiceTask("created", "Voice") },
                { true }, {}, { connected = true })
        }
        creating.await(); job.cancel(); finish.complete(Unit); job.join()
        assertTrue(acknowledged); assertFalse(connected)
    }
    @Test fun doubleTapReentryAndPermissionWaitCannotDispatchAnotherStart() {
        for (phase in listOf("creating", "connecting", "live", "reconnecting", "ending")) assertFalse(canRequestVoiceStart(phase, false))
        assertFalse(canRequestVoiceStart("idle", true))
        assertTrue(canRequestVoiceStart("error", false))
    }
}
