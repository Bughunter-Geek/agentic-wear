package io.github.sirbughunter.agenticwear.data

import org.junit.Assert.assertArrayEquals
import org.junit.Test

class SoftwareEcdhTest {
    @Test
    fun `software P-256 keys produce the same secret on each side`() {
        val watch = generateSoftwareEcKeyPair()
        val bridge = generateSoftwareEcKeyPair()

        assertArrayEquals(
            performSoftwareEcdh(watch.private, bridge.public.encoded),
            performSoftwareEcdh(bridge.private, watch.public.encoded),
        )
    }

    @Test
    fun `encoded software key pair remains usable after reload`() {
        val original = generateSoftwareEcKeyPair()
        val peer = generateSoftwareEcKeyPair()
        val reloaded = decodeSoftwareEcKeyPair(original.public.encoded, original.private.encoded)

        assertArrayEquals(
            performSoftwareEcdh(original.private, peer.public.encoded),
            performSoftwareEcdh(reloaded.private, peer.public.encoded),
        )
    }
}
