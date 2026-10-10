package io.github.sirbughunter.agenticwear.data
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Bounded, process-local work; queued relay messages survive if the app exits or ACK fails. */
internal class InboxAcknowledgements(private val scope: CoroutineScope, private val limit: Int = 4) {
    private val pending = AtomicInteger(0)
    fun schedule(acknowledge: suspend () -> Unit): Boolean {
        while (true) {
            val current = pending.get()
            if (current >= limit) return false
            if (pending.compareAndSet(current, current + 1)) break
        }
        scope.launch {
            try { acknowledge() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* Keep relay inbox entries for a later retry. */ }
            finally { pending.decrementAndGet() }
        }
        return true
    }
}
internal fun publishBeforeAcknowledgement(publish: () -> Unit, queue: InboxAcknowledgements, acknowledge: suspend () -> Unit) {
    publish()
    queue.schedule(acknowledge)
}
