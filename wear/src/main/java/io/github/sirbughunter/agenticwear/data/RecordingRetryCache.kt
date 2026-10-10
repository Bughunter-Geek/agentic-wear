package io.github.sirbughunter.agenticwear.data

import io.github.sirbughunter.agenticwear.model.Transcript

/** One recording, in memory only. A process restart deliberately loses it. */
internal class RecordingRetryCache(
    private val maxBytes: Int = 1_300_000,
    private val lifetimeMillis: Long = 30L * 60L * 1_000L,
) {
    private data class Entry(
        val bytes: ByteArray,
        var requestIds: Set<String>,
        val threadId: String?,
        val revisionBase: Transcript?,
        val createdAt: Long,
    )
    data class Replay(val bytes: ByteArray, val threadId: String?, val revisionBase: Transcript?)
    private var entry: Entry? = null

    @Synchronized fun retain(bytes: ByteArray, requestId: String, threadId: String?, revisionBase: Transcript?, now: Long) {
        require(bytes.isNotEmpty() && bytes.size <= maxBytes)
        clear()
        entry = Entry(bytes.copyOf(), setOf(requestId), threadId, revisionBase, now)
    }
    @Synchronized fun available(requestId: String, now: Long): Boolean {
        expire(now)
        return entry?.requestIds?.contains(requestId) == true
    }
    @Synchronized fun replay(requestId: String, newRequestId: String, now: Long): Replay? {
        require(requestId != newRequestId)
        if (!available(requestId, now)) return null
        val current = entry ?: return null
        // Keep the previous review eligible if this retry fails or is cancelled.
        current.requestIds = setOf(requestId, newRequestId)
        return Replay(current.bytes.copyOf(), current.threadId, current.revisionBase)
    }
    @Synchronized fun clear() {
        entry?.bytes?.fill(0)
        entry = null
    }
    @Synchronized fun expire(now: Long) {
        entry?.let { if (now < it.createdAt || now - it.createdAt >= lifetimeMillis) clear() }
    }
}


internal fun recordingTranscriptionPayload(
    requestId: String,
    audioBase64: String,
    threadId: String?,
    revisionBase: Transcript?,
    backend: String?,
): io.github.sirbughunter.agenticwear.model.BridgePayload.CreateTranscription =
    io.github.sirbughunter.agenticwear.model.BridgePayload.CreateTranscription(
        requestId = requestId,
        audioBase64 = audioBase64,
        mimeType = "audio/aac",
        threadId = threadId,
        previousText = revisionBase?.text,
        backend = backend,
        finalIntent = backend == "phonon" && revisionBase == null,
        localEdit = revisionBase != null,
    )
