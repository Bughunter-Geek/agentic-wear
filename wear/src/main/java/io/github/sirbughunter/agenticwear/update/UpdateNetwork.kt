package io.github.sirbughunter.agenticwear.update

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

internal const val UPDATE_NETWORK_WAIT_MS = 5_000L

/** True when a granted high-bandwidth network should be used; otherwise the default network is kept. */
internal fun shouldUseHighBandwidthNetwork(granted: Boolean, waitedMs: Long, timeoutMs: Long = UPDATE_NETWORK_WAIT_MS): Boolean =
    granted && waitedMs <= timeoutMs

/**
 * Holds a Wi-Fi/cellular request (like live voice) so the APK download avoids the Bluetooth proxy.
 * Blocking; call from the download thread. Not bound process-wide: use network.openConnection(url).
 */
internal class UpdateNetwork(context: Context) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private var callback: ConnectivityManager.NetworkCallback? = null

    /** Returns the granted network, or null (default network fallback). */
    fun acquire(timeoutMs: Long = UPDATE_NETWORK_WAIT_MS): Network? {
        release()
        val latch = CountDownLatch(1)
        val grantedRef = java.util.concurrent.atomic.AtomicReference<Network?>()
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
            .build()
        val registered = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { grantedRef.set(network); latch.countDown() }
        }
        if (runCatching { connectivity.requestNetwork(request, registered) }.isFailure) return null
        callback = registered
        val start = System.nanoTime()
        val arrived = try { latch.await(timeoutMs, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { Thread.currentThread().interrupt(); false }
        val waited = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
        val network = grantedRef.get()
        if (network == null || !shouldUseHighBandwidthNetwork(arrived, waited, timeoutMs + 250)) { release(); return null }
        return network
    }

    fun release() {
        callback?.let { runCatching { connectivity.unregisterNetworkCallback(it) } }
        callback = null
    }
}
