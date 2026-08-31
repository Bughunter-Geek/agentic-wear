package io.github.sirbughunter.agenticwear.update

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateHttpPolicyTest {
    @Test
    fun `a missing latest release is not an updater failure`() {
        assertTrue(isMissingUpdateManifest(404))
        assertFalse(isMissingUpdateManifest(401))
        assertFalse(isMissingUpdateManifest(500))
    }

    @Test
    fun `manifest candidates keep independent sources and remove duplicates`() {
        assertEquals(
            listOf("https://raw.example/update.json", "https://api.example/update.json"),
            updateManifestCandidates(
                " https://raw.example/update.json ",
                "https://api.example/update.json",
            ),
        )
        assertEquals(
            listOf("https://raw.example/update.json"),
            updateManifestCandidates(
                "https://raw.example/update.json",
                "https://raw.example/update.json",
            ),
        )
    }

    @Test
    fun `newest release must be newer than the installed build`() {
        val current = release(31)
        val next = release(32)
        val later = release(33)

        assertEquals(later, newestAvailableRelease(listOf(current, next, later), 31))
        assertNull(newestAvailableRelease(listOf(current), 31))
    }

    private fun release(versionCode: Int) = AppRelease(
        versionCode = versionCode,
        versionName = "0.6.$versionCode",
        apkUrl = "https://example.com/$versionCode.apk",
        sha256 = "0".repeat(64),
        apkSize = 1L,
    )
}
