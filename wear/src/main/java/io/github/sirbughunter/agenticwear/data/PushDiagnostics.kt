package io.github.sirbughunter.agenticwear.data

/**
 * What happened to one FCM "inbox.ready" push. Metadata only: timestamps, FCM priorities, whether and how
 * large the envelope was, and the outcome name. Never message text, titles, ciphertext or ids.
 */
internal data class PushRecord(
    val receivedAt: Long,
    val sentTime: Long,
    val priority: Int,
    val originalPriority: Int,
    val envelopePresent: Boolean,
    val envelopeChars: Int,
    val outcome: String,
    val outcomeAt: Long,
)

/**
 * In-memory, process-wide record of the newest [MAX_ENTRIES] pushes. Written from the messaging service
 * and read by the repository when it reports to the bridge, so every access takes the same lock.
 */
internal object PushDiagnostics {
    const val MAX_ENTRIES = 20

    private val lock = Any()
    private val records = ArrayDeque<PushRecord>(MAX_ENTRIES + 1)

    fun record(entry: PushRecord) {
        synchronized(lock) {
            records.addLast(entry)
            while (records.size > MAX_ENTRIES) records.removeFirst()
        }
    }

    /** Oldest first, at most [MAX_ENTRIES]. The returned list is an independent copy. */
    fun snapshot(): List<PushRecord> = synchronized(lock) { records.toList() }

    /** Removes exactly the given entries; records added after the snapshot stay. */
    fun clear(entries: List<PushRecord>) {
        if (entries.isEmpty()) return
        synchronized(lock) { entries.forEach { records.remove(it) } }
    }

    /** Test hook: empties the process-wide record. */
    internal fun resetForTest() {
        synchronized(lock) { records.clear() }
    }
}
