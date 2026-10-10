package io.github.sirbughunter.agenticwear.live

import android.content.Context
import io.github.sirbughunter.agenticwear.data.AgenticWearRepository
import io.github.sirbughunter.agenticwear.data.CryptoBox
import io.github.sirbughunter.agenticwear.data.RelayApi
import io.github.sirbughunter.agenticwear.data.SecurePairingStore
import java.util.UUID
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import org.json.JSONObject

/** Reuses the existing pairing, encryption and inbox. No ChatGPT token reaches the watch. */
class LiveSignaling(context: Context) {
    private val pairingContext = context.applicationContext
    private val pairing = SecurePairingStore(context)
    private val crypto = CryptoBox(context)
    private val relay = RelayApi()
    private val repository = AgenticWearRepository(context)

    suspend fun send(kind: String, callId: String? = null, fields: JSONObject = JSONObject(), requestId: String = UUID.randomUUID().toString()): String {
        val pair = pairing.read() ?: error("Pair Agentic Wear first")
        val id = requestId
        fields.put("version", 1).put("kind", kind).put("requestId", id)
        callId?.let { fields.put("callId", it) }
        relay.sendToBridge(pair, crypto.encrypt(pair.pairId, pair.bridgePublicKey, fields.toString()))
        return id
    }

    suspend fun poll() { repository.refreshInbox(notify = false) }

    suspend fun createTask(): JSONObject {
        discardOldEvents()
        val storage = taskRequests(pairingContext)
        val pair = pairing.read() ?: error("Pair Agentic Wear first")
        if (storage.getString("pair", null) != pair.pairId) storage.edit().clear().putString("pair", pair.pairId).commit()
        var request = storage.getString("request", null)
        var envelope = storage.getString("envelope", null)
        if (request == null || envelope == null) {
            request = UUID.randomUUID().toString()
            val command = JSONObject().put("version", 1).put("kind", "live.newTask").put("requestId", request)
            envelope = crypto.encrypt(pair.pairId, pair.bridgePublicKey, command.toString()).toString()
            check(storage.edit().putString("request", request).putString("envelope", envelope).commit())
        }
        storage.getString("result", null)?.let { saved ->
            val event = JSONObject(saved)
            if (event.optString("requestId") == request) {
                check(storage.edit().clear().putString("pair", pair.pairId).commit())
                return event.getJSONObject("task")
            }
        }
        // Retry uses exactly the same ciphertext; the bridge replays its durable
        // task receipt instead of creating a second task after a lost reply.
        relay.sendToBridge(pair, JSONObject(envelope))
        return withTimeout(35_000) {
            while (true) {
                poll()
                var event = events.tryReceive().getOrNull()
                while (event != null) {
                    if (event.optString("requestId") == request) {
                        if (event.optString("kind") == "live.taskCreated") {
                            check(storage.edit().clear().putString("pair", pair.pairId).commit())
                            return@withTimeout event.getJSONObject("task")
                        }
                        if (event.optString("kind") == "live.error") {
                            if (!event.optBoolean("deliveryUncertain")) storage.edit().clear().commit()
                            error(event.optString("message", "Could not create a voice task"))
                        }
                    }
                    event = events.tryReceive().getOrNull()
                }
                delay(1000)
            }
            @Suppress("UNREACHABLE_CODE") error("No task response")
        }
    }

    companion object {
        // Small bounded signaling queue; media is carried by WebRTC and never persisted here.
        val events = Channel<JSONObject>(32)
        private fun taskRequests(context: Context) = context.getSharedPreferences("live_voice_task_request", Context.MODE_PRIVATE)
        fun receive(payload: JSONObject, context: Context) {
            val storage = taskRequests(context)
            if (payload.optString("kind") == "live.taskCreated" && payload.optString("requestId") == storage.getString("request", null))
                storage.edit().putString("result", payload.toString()).commit()
            events.trySend(payload)
        }
        fun discardOldEvents() { while (events.tryReceive().isSuccess) Unit }
    }
}
