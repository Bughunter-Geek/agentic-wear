package io.github.sirbughunter.agenticwear.data

/**
 * Relay acknowledgements are sent asynchronously after processing, so a fetch that starts
 * before one lands returns that message again. Remember recently handled relay message ids
 * so a repeat is acknowledged without being processed twice (e.g. a second WebRTC answer).
 */
internal class RecentInboxMessages(private val capacity: Int = 512) {
    private val ids = LinkedHashSet<String>()

    @Synchronized fun handled(id: String): Boolean = id.isNotBlank() && id in ids

    @Synchronized fun remember(id: String) {
        if (id.isBlank()) return
        ids.remove(id)
        ids.add(id)
        while (ids.size > capacity) ids.remove(ids.first())
    }
}
