package io.github.sirbughunter.agenticwear.data

import java.security.KeyStoreException
import java.security.ProviderException
import javax.crypto.AEADBadTagException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidKeyStoreAccessTest {
    @Test
    fun `transient keystore failure is retried with bounded delays`() {
        val expected = Any()
        val sleeps = mutableListOf<Long>()
        var calls = 0

        val actual = retryTransientKeyStoreOperation(
            retryDelaysMillis = longArrayOf(10L, 20L, 30L),
            sleeper = sleeps::add,
        ) {
            calls += 1
            if (calls < 3) throw KeyStoreException("Keystore operation failed")
            expected
        }

        assertSame(expected, actual)
        assertEquals(3, calls)
        assertEquals(listOf(10L, 20L), sleeps)
    }

    @Test
    fun `transient keystore retry stops at configured bound`() {
        var calls = 0
        val failure = KeyStoreException("resource busy")

        val thrown = runCatching {
            retryTransientKeyStoreOperation(
                retryDelaysMillis = longArrayOf(1L, 2L),
                sleeper = {},
            ) {
                calls += 1
                throw failure
            }
        }.exceptionOrNull()

        assertSame(failure, thrown)
        assertEquals(3, calls)
    }

    @Test
    fun `permanent and integrity failures are not retried`() {
        assertFalse(isTransientKeyStoreFailure(IllegalStateException("Key permanently invalidated")))
        assertFalse(isTransientKeyStoreFailure(AEADBadTagException("mac check failed")))
    }

    @Test
    fun `provider and nested hardware failures are retryable`() {
        assertTrue(isTransientKeyStoreFailure(ProviderException("provider unavailable")))
        assertTrue(
            isTransientKeyStoreFailure(
                IllegalStateException("encryption failed", KeyStoreException("Keystore operation failed")),
            ),
        )
    }
}
