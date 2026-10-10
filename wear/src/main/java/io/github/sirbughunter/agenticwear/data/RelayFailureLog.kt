package io.github.sirbughunter.agenticwear.data

/**
 * One failed relay request attempt. Metadata only: the operation name, the HTTP status (0 when no
 * response arrived) and the exception class name. Never a URL, id, token or error message.
 */
internal data class RelayFailure(
    val op: String,
    val status: Int,
    val errorClass: String,
    val at: Long,
)

/**
 * In-memory, process-wide record of the newest [MAX_ENTRIES] failed relay attempts. It is written
 * from [RelayApi] on whatever thread a request runs on and read by the repository when it reports
 * the failures to the bridge, so every access takes the same lock.
 */
internal object RelayFailureLog {
    const val MAX_ENTRIES = 20

    private val lock = Any()
    private val log = ArrayDeque<RelayFailure>(MAX_ENTRIES + 1)

    fun record(op: String, status: Int, errorClass: String, at: Long) {
        synchronized(lock) {
            log.addLast(RelayFailure(op, status, errorClass, at))
            while (log.size > MAX_ENTRIES) log.removeFirst()
        }
    }

    /** Oldest first, at most [MAX_ENTRIES]. The returned list is an independent copy. */
    fun snapshot(): List<RelayFailure> = synchronized(lock) { log.toList() }

    /**
     * Removes exactly the given entries (one stored entry per given entry, so equal duplicates are
     * removed only as many times as they are listed). Entries recorded after the snapshot was taken
     * stay in the log.
     */
    fun clear(entries: List<RelayFailure>) {
        if (entries.isEmpty()) return
        synchronized(lock) {
            entries.forEach { log.remove(it) }
        }
    }

    /** Test hook: empties the process-wide log. */
    internal fun resetForTest() {
        synchronized(lock) { log.clear() }
    }
}
