package io.github.sirbughunter.agenticwear.data

import android.os.Build
import android.security.KeyStoreException as AndroidKeyStoreException
import android.security.keystore.BackendBusyException
import java.security.KeyStore

/**
 * Serializes Android Keystore work across the activity, foreground service, and WorkManager.
 *
 * Every retry loads a fresh KeyStore facade and follows the retry policy reported by Keystore2.
 * KeyMint exponential backoff starts at five seconds; immediate retries only make secure-hardware
 * contention worse.
 */
internal object AndroidKeyStoreAccess {
    private val monitor = Any()

    fun <T> serialized(block: () -> T): T = synchronized(monitor) { block() }

    fun <T> execute(block: (KeyStore) -> T): T = serialized {
        retryAndroidKeyStoreOperation {
            val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
            block(keyStore)
        }
    }

    private const val ANDROID_KEY_STORE = "AndroidKeyStore"
}

internal data class KeyStoreFailureInfo(
    val numericErrorCode: Int? = null,
    val isTransient: Boolean? = null,
    val isSystemError: Boolean? = null,
    val requiresUserAuthentication: Boolean = false,
    val retryPolicy: Int? = null,
    val backOffHintMillis: Long? = null,
)

private fun <T> retryAndroidKeyStoreOperation(
    sleeper: (Long) -> Unit = Thread::sleep,
    operation: () -> T,
): T {
    var retryIndex = 0
    while (true) {
        try {
            return operation()
        } catch (error: Exception) {
            val failure = inspectKeyStoreFailure(error) ?: throw error
            val delayMillis = keyStoreRetryDelayMillis(failure, retryIndex)
                ?: throw IllegalStateException(keyStoreFailureMessage(failure), error)
            sleeper(delayMillis)
            retryIndex += 1
        }
    }
}

private fun inspectKeyStoreFailure(error: Throwable): KeyStoreFailureInfo? {
    val causes = error.causes()
    causes.filterIsInstance<BackendBusyException>().firstOrNull()?.let { busy ->
        return KeyStoreFailureInfo(
            isTransient = true,
            isSystemError = true,
            backOffHintMillis = busy.backOffHintMillis,
        )
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        causes.filterIsInstance<AndroidKeyStoreException>().firstOrNull()?.let { keyStoreError ->
            return KeyStoreFailureInfo(
                numericErrorCode = keyStoreError.numericErrorCode,
                isTransient = keyStoreError.isTransientFailure,
                isSystemError = keyStoreError.isSystemError,
                requiresUserAuthentication = keyStoreError.requiresUserAuthentication(),
                retryPolicy = if (keyStoreError.isTransientFailure) keyStoreError.retryPolicy else null,
            )
        }
    }
    return if (isLegacyRetryableKeyStoreFailure(causes)) {
        KeyStoreFailureInfo(isTransient = true, isSystemError = true)
    } else {
        null
    }
}

internal fun keyStoreRetryDelayMillis(failure: KeyStoreFailureInfo, retryIndex: Int): Long? {
    if (retryIndex < 0 || failure.requiresUserAuthentication || failure.isTransient == false) return null
    failure.backOffHintMillis?.let { hint ->
        return if (retryIndex < MAX_BACKEND_BUSY_RETRIES) hint.coerceIn(50L, 30_000L) else null
    }
    if (failure.numericErrorCode == KEY_OPERATION_EXPIRED_CODE) {
        return OPERATION_EXPIRED_DELAYS_MILLIS.getOrNull(retryIndex)
    }
    return when (failure.retryPolicy) {
        RETRY_NEVER, RETRY_WHEN_CONNECTIVITY_AVAILABLE, RETRY_AFTER_NEXT_REBOOT -> null
        RETRY_WITH_EXPONENTIAL_BACKOFF, null -> EXPONENTIAL_BACKOFF_DELAYS_MILLIS.getOrNull(retryIndex)
        else -> null
    }
}

internal fun keyStoreFailureMessage(failure: KeyStoreFailureInfo): String {
    val code = failure.numericErrorCode?.let { " (security code $it)" }.orEmpty()
    return when {
        failure.requiresUserAuthentication ->
            "Unlock the watch, then try Send again$code."
        failure.retryPolicy == RETRY_WHEN_CONNECTIVITY_AVAILABLE ->
            "Watch security services need a network connection$code. Reconnect, then try Send again."
        failure.retryPolicy == RETRY_AFTER_NEXT_REBOOT ->
            "Watch security services require a restart$code. Restart the watch, then try Send again."
        failure.isTransient == true ->
            "Watch security hardware stayed busy after Android's requested backoff$code. Wait 30 seconds, then try Send again."
        failure.isSystemError == false ->
            "The saved watch encryption key is unusable$code. Re-pair Agentic Wear to replace it."
        else ->
            "Watch security services could not perform encryption$code. Restart the watch; if it continues, re-pair Agentic Wear."
    }
}

private fun Throwable.causes(): List<Throwable> = generateSequence(this) { current ->
    current.cause?.takeUnless { it === current }
}.take(12).toList()

private fun isLegacyRetryableKeyStoreFailure(causes: List<Throwable>): Boolean {
    val normalizedMessage = causes.joinToString(" ") { it.message.orEmpty() }.lowercase()
    if (
        normalizedMessage.contains("permanently invalidated") ||
        normalizedMessage.contains("user not authenticated") ||
        normalizedMessage.contains("authentication required") ||
        normalizedMessage.contains("invalid key blob")
    ) {
        return false
    }
    return normalizedMessage.contains("temporarily busy") ||
        normalizedMessage.contains("temporarily unavailable") ||
        normalizedMessage.contains("resource busy") ||
        normalizedMessage.contains("keystore operation failed") ||
        causes.any { cause ->
            cause is java.security.KeyStoreException || cause.javaClass.name == "android.security.KeyStoreException"
        }
}

private const val KEY_OPERATION_EXPIRED_CODE = 15
private const val RETRY_NEVER = 1
private const val RETRY_WITH_EXPONENTIAL_BACKOFF = 2
private const val RETRY_WHEN_CONNECTIVITY_AVAILABLE = 3
private const val RETRY_AFTER_NEXT_REBOOT = 4
private const val MAX_BACKEND_BUSY_RETRIES = 3
private val OPERATION_EXPIRED_DELAYS_MILLIS = longArrayOf(0L, 100L, 300L)
private val EXPONENTIAL_BACKOFF_DELAYS_MILLIS = longArrayOf(5_000L, 10_000L)
