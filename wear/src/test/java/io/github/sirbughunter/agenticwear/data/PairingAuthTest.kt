package io.github.sirbughunter.agenticwear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingAuthTest {
    @Test
    fun matchesBridgeAuthenticationVector() {
        val authenticator = PairingAuthenticator.fromCode("ABCD-2345")
        try {
            assertEquals("enAbNInJ8okG3POKtCwnI0kuURH9viQTZlCPpcldao4", authenticator.pairId)
            assertEquals(
                "aXjRSCkiEwYziC4YxKbGTPV33nTzES67NNBxcHqn-wo",
                authenticator.createProof("watch", "bridge-public-key", "watch-public-key"),
            )
            assertEquals(
                "v--ZPVadRpXfaAsXsoHdnWy0tzbBMHApKFCrAMT5vow",
                authenticator.createProof("bridge", "bridge-public-key", "watch-public-key"),
            )
        } finally {
            authenticator.clear()
        }
    }

    @Test
    fun rejectsRoleAndKeySubstitution() {
        val authenticator = PairingAuthenticator.fromCode("ABCD2345")
        try {
            val proof = authenticator.createProof("watch", "bridge-public-key", "watch-public-key")
            assertTrue(authenticator.verifyProof("watch", "bridge-public-key", "watch-public-key", proof))
            assertFalse(authenticator.verifyProof("bridge", "bridge-public-key", "watch-public-key", proof))
            assertFalse(authenticator.verifyProof("watch", "changed-bridge-key", "watch-public-key", proof))
            assertFalse(authenticator.verifyProof("watch", "bridge-public-key", "changed-watch-key", proof))
            assertFalse(authenticator.verifyProof("watch", "bridge-public-key", "watch-public-key", "A".repeat(43)))
        } finally {
            authenticator.clear()
        }
    }
}
