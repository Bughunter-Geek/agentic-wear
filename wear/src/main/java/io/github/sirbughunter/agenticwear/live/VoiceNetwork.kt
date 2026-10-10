package io.github.sirbughunter.agenticwear.live

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Wear OS keeps apps on the phone's Bluetooth proxy until one asks for more. That proxy
 * offers WebRTC no usable interface, so an offer gathers no candidates. Holding a Wi-Fi or
 * cellular request for the call wakes a direct network and keeps it up until release().
 */
internal class VoiceNetwork(context: Context) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private var callback: ConnectivityManager.NetworkCallback? = null

    /** Returns a trace label for the network WebRTC can use; never throws for a missing network. */
    suspend fun acquire(timeoutMs: Long = 8_000): String {
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
        val network = withTimeoutOrNull(timeoutMs) { available.await() } ?: return "${currentTransport()}_TIMEOUT"
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
