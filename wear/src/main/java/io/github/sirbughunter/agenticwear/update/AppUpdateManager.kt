package io.github.sirbughunter.agenticwear.update

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.github.sirbughunter.agenticwear.BuildConfig
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import org.json.JSONObject

enum class UpdateStage { IDLE, CHECKING, AVAILABLE, DOWNLOADING, READY, CURRENT, ERROR }

data class AppRelease(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val sha256: String,
    val apkSize: Long?,
)

data class UpdateUiState(
    val enabled: Boolean = false,
    val stage: UpdateStage = UpdateStage.IDLE,
    val release: AppRelease? = null,
    val progress: Int = 0,
    val message: String? = null,
)

internal fun isMissingUpdateManifest(status: Int): Boolean =
    status == HttpURLConnection.HTTP_NOT_FOUND

class AppUpdateManager(private val context: Context) {
    val enabled: Boolean = BuildConfig.UPDATE_MANIFEST_URL.isNotBlank()

    fun checkForUpdate(): AppRelease? {
        check(enabled) { "App updates are not configured for this build" }
        val manifestUrl = validatedUrl(BuildConfig.UPDATE_MANIFEST_URL)
        val connection = openManifestConnection(manifestUrl) ?: return null
        val body = connection.useConnection {
            readLimited(it, MAX_MANIFEST_BYTES).toString(Charsets.UTF_8)
        }
        val release = parseManifest(body, manifestUrl)
        return release.takeIf { it.versionCode > BuildConfig.VERSION_CODE }
    }

    fun download(release: AppRelease, onProgress: (Int) -> Unit): File {
        val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
        val partial = File(updatesDir, "agentic-wear-${release.versionCode}.partial.apk")
        val destination = File(updatesDir, "agentic-wear-${release.versionCode}.apk")
        partial.delete()
        destination.delete()

        val connection = openConnection(validatedUrl(release.apkUrl), APK_MIME_TYPE)
        val expectedBytes = release.apkSize ?: connection.contentLengthLong.takeIf { it > 0 }
        if (expectedBytes != null && expectedBytes > MAX_APK_BYTES) {
            connection.disconnect()
            throw IOException("Update is larger than the allowed download size")
        }

        val digest = MessageDigest.getInstance("SHA-256")
        var total = 0L
        var lastProgress = -1
        try {
            connection.inputStream.buffered().use { input ->
                partial.outputStream().buffered().use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        if (total > MAX_APK_BYTES) throw IOException("Update is larger than the allowed download size")
                        output.write(buffer, 0, read)
                        digest.update(buffer, 0, read)
                        val progress = expectedBytes?.let { ((total * 100L) / it).coerceIn(0L, 100L).toInt() } ?: 0
                        if (progress != lastProgress) {
                            lastProgress = progress
                            onProgress(progress)
                        }
                    }
                }
            }
        } catch (error: Throwable) {
            partial.delete()
            throw error
        } finally {
            connection.disconnect()
        }

        if (release.apkSize != null && total != release.apkSize) {
            partial.delete()
            throw IOException("Update download size does not match its manifest")
        }
        val actualSha256 = digest.digest().toHex()
        if (!actualSha256.equals(release.sha256, ignoreCase = true)) {
            partial.delete()
            throw IOException("Update checksum verification failed")
        }
        verifyPackage(partial, release)
        if (!partial.renameTo(destination)) {
            partial.delete()
            throw IOException("Could not finalize the downloaded update")
        }
        onProgress(100)
        return destination
    }

    fun canRequestInstalls(): Boolean = context.packageManager.canRequestPackageInstalls()

    fun openInstallPermission(): Boolean {
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return launchIfResolvable(intent)
    }

    fun launchInstaller(apk: File): Boolean {
        if (!apk.isFile) return false
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, APK_MIME_TYPE)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        return launchIfResolvable(intent)
    }

    private fun launchIfResolvable(intent: Intent): Boolean {
        if (intent.resolveActivity(context.packageManager) == null) return false
        context.startActivity(intent)
        return true
    }

    private fun parseManifest(body: String, baseUrl: URL): AppRelease {
        val json = runCatching { JSONObject(body) }
            .getOrElse { throw IOException("Update manifest is not valid JSON", it) }
        val versionCode = json.optInt("versionCode", -1)
        val versionName = json.optString("versionName").trim()
        val apkUrlValue = json.optString("apkUrl").trim()
        val sha256 = json.optString("sha256").trim().lowercase(Locale.US)
        val apkSize = json.optLong("apkSize", -1L).takeIf { it > 0L }
        if (versionCode <= 0) throw IOException("Update manifest has an invalid version code")
        if (versionName.isBlank() || versionName.length > 40) throw IOException("Update manifest has an invalid version name")
        if (apkUrlValue.isBlank() || apkUrlValue.length > 2_048) throw IOException("Update manifest has an invalid APK URL")
        if (sha256.length != 64 || sha256.any { it !in '0'..'9' && it !in 'a'..'f' }) {
            throw IOException("Update manifest has an invalid checksum")
        }
        if (apkSize != null && apkSize > MAX_APK_BYTES) throw IOException("Update manifest declares an oversized APK")
        val resolvedApkUrl = runCatching { URL(baseUrl, apkUrlValue) }
            .getOrElse { throw IOException("Update manifest has an invalid APK URL", it) }
        validatedUrl(resolvedApkUrl.toString())
        return AppRelease(versionCode, versionName, resolvedApkUrl.toString(), sha256, apkSize)
    }

    private fun openConnection(initialUrl: URL, accept: String): HttpURLConnection {
        return openConnectionOrNull(initialUrl, accept, missingManifestIsNoUpdate = false)
            ?: error("Only update manifests may be absent")
    }

    private fun openManifestConnection(initialUrl: URL): HttpURLConnection? =
        openConnectionOrNull(initialUrl, "application/json", missingManifestIsNoUpdate = true)

    private fun openConnectionOrNull(
        initialUrl: URL,
        accept: String,
        missingManifestIsNoUpdate: Boolean,
    ): HttpURLConnection? {
        var current = initialUrl
        repeat(MAX_REDIRECTS + 1) { redirectCount ->
            validatedUrl(current.toString())
            val connection = (current.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                requestMethod = "GET"
                setRequestProperty("Accept", accept)
                setRequestProperty("User-Agent", "Agentic-Wear/${BuildConfig.VERSION_NAME}")
            }
            val status = connection.responseCode
            if (status in REDIRECT_CODES) {
                val location = connection.getHeaderField("Location")
                connection.disconnect()
                if (redirectCount == MAX_REDIRECTS || location.isNullOrBlank()) {
                    throw IOException("Update server redirected too many times")
                }
                current = runCatching { URL(current, location) }
                    .getOrElse { throw IOException("Update server returned an invalid redirect", it) }
            } else {
                if (missingManifestIsNoUpdate && isMissingUpdateManifest(status)) {
                    connection.disconnect()
                    return null
                }
                if (status !in 200..299) {
                    connection.disconnect()
                    throw IOException("Update server returned HTTP $status")
                }
                return connection
            }
        }
        throw IOException("Update server redirected too many times")
    }

    private fun validatedUrl(value: String): URL {
        val url = runCatching { URL(value) }.getOrElse { throw IOException("Update URL is invalid", it) }
        val localDebugUrl = BuildConfig.DEBUG && url.protocol == "http" &&
            url.host in setOf("10.0.2.2", "127.0.0.1", "localhost")
        if (url.protocol != "https" && !localDebugUrl) throw IOException("Update URL must use HTTPS")
        if (url.userInfo != null || url.host.isBlank()) throw IOException("Update URL is not trusted")
        return url
    }

    private fun readLimited(connection: HttpURLConnection, maxBytes: Int): ByteArray {
        if (connection.contentLengthLong > maxBytes) throw IOException("Update manifest is too large")
        val output = ByteArrayOutputStream()
        connection.inputStream.buffered().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                if (output.size() + read > maxBytes) throw IOException("Update manifest is too large")
                output.write(buffer, 0, read)
            }
        }
        return output.toByteArray()
    }

    @Suppress("DEPRECATION")
    private fun verifyPackage(apk: File, release: AppRelease) {
        val flags = PackageManager.GET_SIGNING_CERTIFICATES
        val archive = if (Build.VERSION.SDK_INT >= 33) {
            context.packageManager.getPackageArchiveInfo(apk.path, PackageManager.PackageInfoFlags.of(flags.toLong()))
        } else {
            context.packageManager.getPackageArchiveInfo(apk.path, flags)
        } ?: throw IOException("Downloaded file is not a valid APK")
        if (archive.packageName != context.packageName) throw IOException("Update APK has the wrong package name")
        if (archive.longVersionCode != release.versionCode.toLong()) throw IOException("Update APK version does not match its manifest")

        val installed = if (Build.VERSION.SDK_INT >= 33) {
            context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(flags.toLong()))
        } else {
            context.packageManager.getPackageInfo(context.packageName, flags)
        }
        if (signerDigests(archive).intersect(signerDigests(installed)).isEmpty()) {
            throw IOException("Update APK is not signed by the installed app's key")
        }
    }

    private fun signerDigests(info: PackageInfo): Set<String> {
        val signingInfo = info.signingInfo ?: return emptySet()
        val signatures = if (signingInfo.hasMultipleSigners()) {
            signingInfo.apkContentsSigners
        } else {
            signingInfo.signingCertificateHistory
        }
        return signatures.mapTo(mutableSetOf()) {
            MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).toHex()
        }
    }

    private inline fun <T> HttpURLConnection.useConnection(block: (HttpURLConnection) -> T): T =
        try {
            block(this)
        } finally {
            disconnect()
        }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(Locale.US, it.toInt() and 0xff) }

    private companion object {
        const val APK_MIME_TYPE = "application/vnd.android.package-archive"
        const val MAX_MANIFEST_BYTES = 64 * 1024
        const val MAX_APK_BYTES = 100L * 1024L * 1024L
        const val CONNECT_TIMEOUT_MS = 10_000
        const val READ_TIMEOUT_MS = 30_000
        const val MAX_REDIRECTS = 5
        val REDIRECT_CODES = setOf(301, 302, 303, 307, 308)
    }
}
