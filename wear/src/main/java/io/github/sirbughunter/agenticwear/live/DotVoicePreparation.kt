package io.github.sirbughunter.agenticwear.live

import android.content.Context
import android.os.SystemClock
import io.github.sirbughunter.agenticwear.BuildConfig
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.json.JSONObject

/** One visible-Dot preparation. No foreground microphone service, audio source or persisted SDP. */
internal object DotVoicePreparation {
    private const val TTL_MS = 45_000L
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    @Volatile private var current: Entry? = null
    private var callOpeningUntil = 0L

    class Entry(val thread: String, val context: Context) {
        val id = UUID.randomUUID().toString()
        val capabilityId = UUID.randomUUID().toString()
        val createdAt = SystemClock.elapsedRealtime()
        val events = Channel<JSONObject>(32)
        val capability = CompletableDeferred<JSONObject>()
        val ready = CompletableDeferred<Entry?>()
        val signaling = LiveSignaling(context)
        var peer: NativeLivePeer? = null
        var network: VoiceNetwork? = null
        var releaseMonitor: (() -> Unit)? = null
        var catalog: JSONObject? = null
        var sdp = ""
        var answerApplied = false
        var transportSeq = 0
        var dispatched = false
        var claimed = false
        var stopped = false
        var setup: Job? = null
        var eventJob: Job? = null
        var poll: Job? = null
        var expiry: Job? = null
    }

    fun open(context: Context, thread: String) {
        if (!thread.startsWith("dot:")) { cancel(); return }
        if (!BuildConfig.LIVE_VOICE_RUNTIME || LiveVoiceService.state.value.phase in setOf("creating", "connecting", "live", "reconnecting")) return
        val previous = current
        if (previous?.thread == thread && !previous.stopped) return
        cancel()
        val entry = Entry(thread, context.applicationContext)
        synchronized(this) { current = entry }
        entry.expiry = scope.launch { delay(TTL_MS); stop(entry) }
        entry.eventJob = scope.launch {
            for (event in entry.events) {
                if (event.optString("requestId") == entry.capabilityId) {
                    if (event.optString("kind") == "live.capability") entry.capability.complete(event)
                    else entry.capability.completeExceptionally(IllegalStateException("Preparation unavailable"))
                } else when (event.optString("kind")) {
                    "live.answer" -> if (!entry.answerApplied) {
                        try { entry.peer?.answer(event.getString("sdp")); entry.answerApplied = true }
                        catch (_: Exception) { stop(entry) }
                    }
                    "live.closed", "live.error" -> stop(entry)
                }
            }
        }
        entry.poll = scope.launch(Dispatchers.IO) {
            while (isActive) { runCatching { entry.signaling.poll() }; delay(500) }
        }
        entry.setup = scope.launch {
            try {
                withContext(Dispatchers.IO) { entry.signaling.send("live.capability", fields = JSONObject().put("threadId", thread), requestId = entry.capabilityId) }
                val catalog = withTimeout(10_000) { entry.capability.await() }
                if (!catalog.optBoolean("nativeDotPreparation") || !catalog.optBoolean("nativeDot") || !catalog.optBoolean("realtimeApiAvailable")) { stop(entry); return@launch }
                entry.catalog = catalog
                entry.releaseMonitor = NativeLivePeer.warmUpNetworkMonitor(entry.context)
                val network = VoiceNetwork(entry.context).also { entry.network = it }
                val transport = network.acquire(bluetoothDefaultRoute = CompletableDeferred(true))
                val result = withContext(Dispatchers.Default) {
                    offerWithFreshPeers(create = {
                        NativeLivePeer(entry.context, { state ->
                            if (state == "failed" || state == "disconnected") scope.launch { if (current === entry && !entry.claimed) stop(entry) }
                        }, {}, { peer, ice, channel -> scope.launch {
                            if (!entry.stopped && !entry.claimed && current === entry && entry.dispatched) {
                                val seq = ++entry.transportSeq
                                launch(Dispatchers.IO) { runCatching { entry.signaling.send("live.transport", entry.id,
                                    JSONObject().put("transport", JSONObject().put("seq", seq).put("peerState", peer).put("iceState", ice).put("channelState", channel))) } }
                            }
                        } }, defaultNetworkRoute = transport == "BLUETOOTH", prepareSilently = true).also { peer ->
                            synchronized(entry) {
                                if (entry.stopped) { peer.close(); throw CancellationException("Preparation cancelled") }
                                entry.peer = peer
                            }
                        }
                    }, offer = { withTimeout(15_000) { it.offer() } })
                }
                // Cancellation between construction and assignment must still close the new peer.
                if (entry.stopped) { result.first.close(); return@launch }
                entry.peer = result.first as NativeLivePeer; entry.sdp = result.second
                entry.dispatched = true
                withContext(Dispatchers.IO) { entry.signaling.send("live.prepare", entry.id, JSONObject().put("threadId", thread).put("sdp", entry.sdp)) }
                entry.ready.complete(entry)
            } catch (cancelled: CancellationException) { stop(entry); throw cancelled }
            catch (_: Throwable) { stop(entry) }
        }
    }

    /** Protects the activity transition only after the user taps Call. */
    fun openingCall() { callOpeningUntil = SystemClock.elapsedRealtime() + 10_000 }
    fun backgrounded() { if (SystemClock.elapsedRealtime() >= callOpeningUntil) cancel() }
    fun claim(thread: String): Entry? {
        val entry = current ?: return null
        if (entry.thread != thread || entry.stopped || entry.claimed || SystemClock.elapsedRealtime() - entry.createdAt >= TTL_MS) { cancel(); return null }
        if (!entry.dispatched) { stop(entry); return null }
        entry.claimed = true
        callOpeningUntil = 0
        return entry
    }
    /** Called after the service binds its callbacks and owns the same peer/network. */
    suspend fun handoff(entry: Entry) {
        synchronized(this) { if (current === entry) current = null }
        entry.expiry?.cancel(); entry.poll?.cancel(); entry.events.close()
        withTimeout(5_000) { entry.eventJob?.join() }
        check(!entry.stopped) { "Preparation ended. Reconnect when ready." }
        entry.peer = null; entry.network = null; entry.releaseMonitor = null
    }
    fun receive(event: JSONObject): Boolean = synchronized(this) {
        val entry = current ?: return false
        if (event.optString("requestId") != entry.capabilityId && event.optString("callId") != entry.id) return false
        entry.events.trySend(event).isSuccess
    }
    fun abandon(entry: Entry?) { entry?.let(::stop) }
    fun cancel() { current?.takeUnless { it.claimed }?.let(::stop) }
    private fun stop(entry: Entry) {
        if (entry.stopped) return
        synchronized(entry) { entry.stopped = true; entry.peer?.close(); entry.peer = null }
        synchronized(this) { if (current === entry) current = null }
        entry.ready.complete(null)
        entry.setup?.cancel(); entry.expiry?.cancel(); entry.poll?.cancel(); entry.eventJob?.cancel(); entry.events.close()
        entry.network?.release(); entry.network = null
        entry.releaseMonitor?.invoke(); entry.releaseMonitor = null
        if (entry.claimed) LiveSignaling.events.trySend(JSONObject().put("kind", "live.error").put("callId", entry.id).put("message", "Preparation ended. Reconnect when ready."))
        if (entry.dispatched) scope.launch(Dispatchers.IO) { runCatching { withTimeout(10_000) { entry.signaling.send("live.stop", entry.id) } } }
    }
}
