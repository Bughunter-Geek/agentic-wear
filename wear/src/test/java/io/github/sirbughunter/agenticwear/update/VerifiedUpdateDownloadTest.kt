package io.github.sirbughunter.agenticwear.update

import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Test

class VerifiedUpdateDownloadTest {
    private val bytes = "signed-apk-fixture-content".toByteArray()
    private val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
    private val release = AppRelease(64, "test", "https://example.com/update", hash, bytes.size.toLong())
    private val dir = Files.createTempDirectory("update-test").toFile().apply { deleteOnExit() }
    private val part get() = File(dir, "partial")
    private val apk get() = File(dir, "verified")
    private var verified = 0
    private fun connection(data: ByteArray, range: String? = null) = object : HttpURLConnection(URL(release.apkUrl)) {
        override fun connect() {}
        override fun disconnect() {}
        override fun usingProxy() = false
        override fun getResponseCode() = if (range == null) 200 else 206
        override fun getHeaderField(name: String?) = if (name == "Content-Range") range else null
        override fun getContentLengthLong() = data.size.toLong()
        override fun getInputStream() = ByteArrayInputStream(data)
    }
    private fun run(open: (Long) -> HttpURLConnection, active: () -> Unit = {}): File =
        verifiedUpdateDownload(part, apk, release, 1024, open, active, {}, { verified++ })
    @Test fun interruptedTransferResumesAndVerifiesBeforeInstall() {
        var requests = 0
        val file = run({ offset -> requests++
            if (requests == 1) connection(bytes.copyOfRange(0, 7))
            else { assertEquals(7L, offset); connection(bytes.copyOfRange(7, bytes.size), "bytes 7-${bytes.size - 1}/${bytes.size}") }
        })
        assertArrayEquals(bytes, file.readBytes()); assertEquals(1, verified); assertEquals(2, requests)
    }
    @Test fun serverIgnoringRangeRestartsSafely() {
        part.writeBytes(bytes.copyOfRange(0, 5)); run({ assertEquals(5L, it); connection(bytes) })
        assertArrayEquals(bytes, apk.readBytes()); assertEquals(1, verified)
    }
    @Test fun processRestartUsesCompletedPartialWithoutAnotherDownload() {
        part.writeBytes(bytes); run({ fail("No request needed"); connection(bytes) }); assertEquals(1, verified)
    }
    @Test fun networkLossKeepsOnlyPartialForNextAttempt() {
        part.writeBytes(bytes.copyOfRange(0, 5))
        try { run({ throw IOException("Offline") }); fail() } catch (_: IOException) {}
        assertEquals(5L, part.length()); assertFalse(apk.exists()); assertEquals(0, verified)
        run({ connection(bytes.copyOfRange(5, bytes.size), "bytes 5-${bytes.size-1}/${bytes.size}") }); assertEquals(1, verified)
    }
    @Test fun badRangeCannotProduceInstallableFile() {
        part.writeBytes(bytes.copyOfRange(0, 5))
        try { run({ connection(bytes, "bytes 0-${bytes.size-1}/${bytes.size}") }); fail() } catch (_: IOException) {}
        assertFalse(apk.exists()); assertEquals(0, verified)
    }
    @Test fun checksumMismatchDeletesPartialAndNeverChecksPackage() {
        try { run({ connection(ByteArray(bytes.size)) }); fail() } catch (_: IOException) {}
        assertFalse(part.exists()); assertFalse(apk.exists()); assertEquals(0, verified)
    }
    @Test fun cancelDeletesPartialAndNeverHandsOffToInstaller() {
        var checks = 0
        try { run({ connection(bytes) }, { if (++checks > 2) throw UpdateDownloadCancelled() }); fail() } catch (_: UpdateDownloadCancelled) {}
        assertFalse(part.exists()); assertFalse(apk.exists()); assertEquals(0, verified)
    }
    @Test fun alreadyVerifiedApkIsRecheckedWithoutDownload() {
        apk.writeBytes(bytes); run({ fail("No request needed"); connection(bytes) }); assertEquals(1, verified)
    }
    @Test fun packageVerificationFailureCannotFinalizeApk() {
        try {
            verifiedUpdateDownload(part, apk, release, 1024, { connection(bytes) }, {}, {}, { throw IOException("Wrong signer") })
            fail()
        } catch (_: IOException) {}
        assertFalse(part.exists()); assertFalse(apk.exists())
    }
    @Test fun boundedStopPreservesPartialForExplicitResume() {
        part.writeBytes(bytes.copyOfRange(0, 5))
        try { run({ connection(bytes) }, { throw UpdateDownloadCancelled(false) }); fail() } catch (_: UpdateDownloadCancelled) {}
        assertEquals(5L, part.length()); assertFalse(apk.exists())
    }

}
