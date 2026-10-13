package io.github.sirbughunter.agenticwear.live

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class VoiceNetworkPreparationTest {
    @Test fun slowNativeCatalogDoesNotAddAnotherRadioGrace() = runTest {
        val native = CompletableDeferred<Boolean>()
        launch { delay(1_150); native.complete(true) }
        assertNull(awaitVoiceNetworkPreparation(CompletableDeferred<String>(), 8_000, native) { currentTime })
        assertEquals(1_150L, currentTime)
    }

    @Test fun fastNativeCatalogStillAllowsTheFullRadioGrace() = runTest {
        val native = CompletableDeferred<Boolean>()
        launch { delay(200); native.complete(true) }
        assertNull(awaitVoiceNetworkPreparation(CompletableDeferred<String>(), 8_000, native) { currentTime })
        assertEquals(1_000L, currentTime)
    }

    @Test fun hotspotFoundDuringTheCatalogReplyRetainsPriority() = runTest {
        val native = CompletableDeferred<Boolean>()
        val available = CompletableDeferred<String>()
        launch { delay(400); available.complete("WIFI") }
        launch { delay(1_150); native.complete(true) }
        assertEquals("WIFI", awaitVoiceNetworkPreparation(available, 8_000, native) { currentTime })
        assertEquals(1_150L, currentTime)
    }

    @Test fun nonNativeCatalogRetainsTheOrdinaryRadioDeadline() = runTest {
        val native = CompletableDeferred<Boolean>()
        launch { delay(250); native.complete(false) }
        assertNull(awaitVoiceNetworkPreparation(CompletableDeferred<String>(), 8_000, native) { currentTime })
        assertEquals(8_000L, currentTime)
    }

    @Test fun ordinaryDirectNetworkDoesNotWaitForACatalog() = runTest {
        val available = CompletableDeferred<String>()
        launch { delay(200); available.complete("CELLULAR") }
        assertEquals("CELLULAR", awaitVoiceNetworkPreparation(available, 8_000, null) { currentTime })
        assertEquals(200L, currentTime)
    }

    @Test fun canceledCatalogCannotPermitTheBluetoothRoute() = runTest {
        val native = CompletableDeferred<Boolean>()
        launch { delay(300); native.cancel() }
        try {
            awaitVoiceNetworkPreparation(CompletableDeferred<String>(), 8_000, native) { currentTime }
            fail("Canceled catalog must stop preparation")
        } catch (_: CancellationException) {
            assertEquals(300L, currentTime)
        }
    }

    @Test fun endingWhileTheCatalogIsPendingCannotReturnANetworkResult() = runTest {
        val native = CompletableDeferred<Boolean>()
        val available = CompletableDeferred<String>()
        var returned = false
        val preparation = launch {
            awaitVoiceNetworkPreparation(available, 8_000, native) { currentTime }
            returned = true
        }
        delay(400)
        preparation.cancelAndJoin()
        assertFalse(returned)
        assertFalse(native.isCancelled)
        assertFalse(available.isCancelled)
    }
}
