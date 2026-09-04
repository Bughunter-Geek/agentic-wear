package io.github.sirbughunter.agenticwear.data

import java.security.KeyStore

/**
 * Serializes Android Keystore work across the activity, foreground service, and WorkManager.
 *
 * Each attempt loads a fresh KeyStore facade. Reusing a facade after Keystore2 reports a
 * transient failure can keep returning the same stale binder/provider state on Wear OS.
 */
internal object AndroidKeyStoreAccess {
    private val monitor = Any()

    fun <T> serialized(block: () -> T): T = synchronized(monitor) { block() }

    fun <T> execute(block: (KeyStore) -> T): T = serialized {
        retryTransientKeyStoreOperation {
            val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
            block(keyStore)
        }
    }

    private const val ANDROID_KEY_STORE = "AndroidKeyStore"
}

internal fun <T> retryTransientKeyStoreOperation(
    retryDelaysMillis: LongArray = longArrayOf(60L, 180L, 420L),
    sleeper: (Long) -> Unit = Thread::sleep,
    operation: () -> T,
): T {
    var attempt = 0
    while (true) {
        try {
            return operation()
        } catch (error: Exception) {
            if (!isTransientKeyStoreFailure(error) || attempt >= retryDelaysMillis.size) throw error
            sleeper(retryDelaysMillis[attempt])
            attempt += 1
        }
    }
}

internal fun isTransientKeyStoreFailure(error: Throwable): Boolean {
    val causes = generateSequence(error) { current ->
        current.cause?.takeUnless { it === current }
    }.take(12).toList()
    val normalizedMessage = causes.joinToString(" ") { it.message.orEmpty() }.lowercase()

    if (
        normalizedMessage.contains("permanently invalidated") ||
        normalizedMessage.contains("user not authenticated") ||
        normalizedMessage.contains("authentication required") ||
        normalizedMessage.contains("invalid key blob")
    ) {
        return false
    }

    if (
        normalizedMessage.contains("temporarily busy") ||
        normalizedMessage.contains("temporarily unavailable") ||
        normalizedMessage.contains("try again") ||
        normalizedMessage.contains("resource busy") ||
        normalizedMessage.contains("keystore operation failed")
    ) {
        return true
    }

    return causes.any { cause ->
        cause.javaClass.name == "android.security.KeyStoreException" ||
            cause is java.security.KeyStoreException ||
            cause is java.security.ProviderException
    }
}
