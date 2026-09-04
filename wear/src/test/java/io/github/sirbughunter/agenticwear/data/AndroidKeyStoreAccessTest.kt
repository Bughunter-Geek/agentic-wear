package io.github.sirbughunter.agenticwear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidKeyStoreAccessTest {
    @Test
    fun `exponential retry policy starts at Android minimum backoff`() {
        val failure = KeyStoreFailureInfo(isTransient = true, isSystemError = true, retryPolicy = 2)

        assertEquals(5_000L, keyStoreRetryDelayMillis(failure, 0))
        assertEquals(10_000L, keyStoreRetryDelayMillis(failure, 1))
        assertNull(keyStoreRetryDelayMillis(failure, 2))
    }

    @Test
    fun `backend busy hint is honored and bounded`() {
        val normal = KeyStoreFailureInfo(isTransient = true, backOffHintMillis = 1_250L)
        val tooSmall = KeyStoreFailureInfo(isTransient = true, backOffHintMillis = 0L)
        val tooLarge = KeyStoreFailureInfo(isTransient = true, backOffHintMillis = 90_000L)

        assertEquals(1_250L, keyStoreRetryDelayMillis(normal, 0))
        assertEquals(50L, keyStoreRetryDelayMillis(tooSmall, 0))
        assertEquals(30_000L, keyStoreRetryDelayMillis(tooLarge, 0))
        assertNull(keyStoreRetryDelayMillis(normal, 3))
    }

    @Test
    fun `evacuated operation recreates crypto immediately before short retries`() {
        val failure = KeyStoreFailureInfo(numericErrorCode = 15, isTransient = true)

        assertEquals(0L, keyStoreRetryDelayMillis(failure, 0))
        assertEquals(100L, keyStoreRetryDelayMillis(failure, 1))
        assertEquals(300L, keyStoreRetryDelayMillis(failure, 2))
        assertNull(keyStoreRetryDelayMillis(failure, 3))
    }

    @Test
    fun `permanent and authentication failures are never retried`() {
        assertNull(keyStoreRetryDelayMillis(KeyStoreFailureInfo(isTransient = false), 0))
        assertNull(
            keyStoreRetryDelayMillis(
                KeyStoreFailureInfo(isTransient = true, requiresUserAuthentication = true),
                0,
            ),
        )
    }

    @Test
    fun `failure guidance preserves numeric diagnosis and recovery`() {
        val transient = keyStoreFailureMessage(
            KeyStoreFailureInfo(numericErrorCode = 10, isTransient = true, isSystemError = true),
        )
        val corrupted = keyStoreFailureMessage(
            KeyStoreFailureInfo(numericErrorCode = 7, isTransient = false, isSystemError = false),
        )

        assertTrue(transient.contains("security code 10"))
        assertTrue(transient.contains("Android's requested backoff"))
        assertTrue(corrupted.contains("security code 7"))
        assertTrue(corrupted.contains("Re-pair"))
    }
}
