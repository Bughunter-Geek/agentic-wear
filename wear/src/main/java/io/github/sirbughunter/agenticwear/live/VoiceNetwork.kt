package io.github.sirbughunter.agenticwear.live

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.SystemClock
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred

/**
 * Holding a Wi-Fi or cellular request wakes a direct network and keeps it up until
 * release(). Verified native Dot calls can also use the phone's Bluetooth default
 * route through WebRTC's wildcard ports, without an enumerated adapter candidate.
 */
internal class VoiceNetwork(context: Context) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private var callback: ConnectivityManager.NetworkCallback? = null

    /** Returns a trace label for the network WebRTC can use; never throws for a missing network. */
    suspend fun acquire(timeoutMs: Long = 8_000, bluetoothDefaultRoute: Deferred<Boolean>? = null): String {
        if (callback != null) return currentTransport()
        val available = CompletableDeferred<Network>()
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
            .build()
        val registered = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { available.complete(network) }
        }
        val accepted = runCatching { connectivity.requestNetwork(request, registered) }.isSuccess
        if (!accepted) return "${currentTransport()}_UNREQUESTED"
        callback = registered
        // Still wake/prefer an available direct radio, including a saved phone
        // hotspot. A verified Bluetooth Dot can then try the existing default
        // route without spending the ordinary eight-second wake-up deadline.
        // Keep the request registered for this call and release it normally.
        val network = awaitVoiceNetworkPreparation(available, timeoutMs, bluetoothDefaultRoute, SystemClock::elapsedRealtime)
        if (network == null) return if (bluetoothDefaultRoute?.await() == true && currentTransport() == "BLUETOOTH")
            "BLUETOOTH" else "${currentTransport()}_TIMEOUT"
        return transport(connectivity.getNetworkCapabilities(network))
    }

    fun currentTransport(): String = transport(connectivity.activeNetwork?.let(connectivity::getNetworkCapabilities))

    fun release() {
        callback?.let { runCatching { connectivity.unregisterNetworkCallback(it) } }
        callback = null
    }

    private fun transport(capabilities: NetworkCapabilities?): String = when {
        capabilities == null -> "NONE"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "CELLULAR"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) -> "BLUETOOTH"
        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ETHERNET"
        else -> "OTHER_NET"
    }
}
