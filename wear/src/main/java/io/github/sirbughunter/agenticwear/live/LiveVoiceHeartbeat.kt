package io.github.sirbughunter.agenticwear.live

import io.github.sirbughunter.agenticwear.data.RelayException
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.withTimeoutOrNull

/** Brief transport failures must not end otherwise healthy media on the first miss.
 * Keep the existing 10s cadence and a 30s retry budget; the bridge keeps its 45s lease.
 * This owns signaling retries only; it never creates media or changes a network.
 */
internal suspend fun maintainLiveHeartbeat(
    now: () -> Long,
    wait: suspend (Long) -> Unit,
    stillCurrent: () -> Boolean,
    send: suspend () -> Unit,
    lost: suspend () -> Unit,
) {
    var lastSuccess = now()
    var interval = 10_000L
    while (stillCurrent()) {
        wait(interval)
        if (!stillCurrent()) return
        if (now() - lastSuccess >= 30_000L) { lost(); return }
        try {
            send()
            lastSuccess = now()
            interval = 10_000L
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            val transient = error is IOException || error is RelayException &&
                (error.status in setOf(408, 429) || error.status in 500..599)
            if (!transient || now() - lastSuccess >= 30_000L) { lost(); return }
            interval = 2_000L
        }
    }
}

/** The first successful connection settles startup, even during a later reconnect. */
internal suspend fun awaitLiveMediaStart(firstConnection: Deferred<Unit>): Boolean =
    withTimeoutOrNull(30_000L) { firstConnection.await(); true } ?: false
