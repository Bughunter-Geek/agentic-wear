package io.github.sirbughunter.agenticwear.live

import kotlinx.coroutines.Deferred
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withTimeoutOrNull

/** The radio request runs while the Bluetooth Dot catalog is checked. */
internal suspend fun <T> awaitVoiceNetworkPreparation(
    available: Deferred<T>,
    timeoutMs: Long,
    bluetoothDefaultRoute: Deferred<Boolean>?,
    now: () -> Long,
): T? {
    val requestedAt = now()
    val nativeBluetooth = bluetoothDefaultRoute?.await() == true
    currentCoroutineContext().ensureActive()
    // Count the radio grace from the request, not from the catalog reply.
    // A direct network already found during that reply still takes priority.
    if (available.isCompleted) return available.await()
    val deadline = if (nativeBluetooth) minOf(timeoutMs, 1_000) else timeoutMs
    val elapsed = (now() - requestedAt).coerceAtLeast(0)
    return withTimeoutOrNull((deadline - elapsed).coerceAtLeast(0)) { available.await() }
}
