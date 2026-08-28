package io.github.sirbughunter.agenticwear.update

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateHttpPolicyTest {
    @Test
    fun `a missing latest release is not an updater failure`() {
        assertTrue(isMissingUpdateManifest(404))
        assertFalse(isMissingUpdateManifest(401))
        assertFalse(isMissingUpdateManifest(500))
    }
}
