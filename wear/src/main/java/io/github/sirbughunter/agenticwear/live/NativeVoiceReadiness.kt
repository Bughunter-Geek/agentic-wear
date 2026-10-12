package io.github.sirbughunter.agenticwear.live

/** Media connectivity does not prove that the native Dot has attached the call. */
internal class NativeVoiceReadiness {
    var requiresHostAcceptance: Boolean = false
        private set
    private var hostAccepted = false
    private var mediaConnected = false

    val ready: Boolean get() = mediaConnected && (!requiresHostAcceptance || hostAccepted)
    fun configure(requiresHost: Boolean) { requiresHostAcceptance = requiresHost }
    fun accepted() { hostAccepted = true }
    fun connected(value: Boolean) { mediaConnected = value }
    fun effectiveMute(userMuted: Boolean): Boolean = userMuted || (requiresHostAcceptance && !hostAccepted)
}
