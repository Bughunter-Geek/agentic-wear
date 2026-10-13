package io.github.sirbughunter.agenticwear.live

import android.content.Context

class NativeLivePeer(context: Context, onState: (String) -> Unit, onCaption: (String) -> Unit,
    onTransport: (String, String, String) -> Unit = { _, _, _ -> }, onFullCaption: (String) -> Unit = {},
    defaultNetworkRoute: Boolean = false) : LivePeer {
    override suspend fun offer(): String = error("This build has no WebRTC runtime. Install the private live voice build after download approval.")
    override suspend fun answer(sdp: String) = Unit
    override fun mute(muted: Boolean) = Unit
    override fun levels(callback: (Float, Float) -> Unit) = callback(0f, 0f)
    override fun close() = Unit

    companion object {
        fun warmUpNetworkMonitor(context: Context): () -> Unit = {}
    }
}
