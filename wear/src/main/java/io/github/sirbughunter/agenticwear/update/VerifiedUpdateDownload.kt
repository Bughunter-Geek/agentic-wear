package io.github.sirbughunter.agenticwear.update

import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.security.MessageDigest

internal class UpdateDownloadCancelled(val discardPartial: Boolean = true) : IOException("Update cancelled")

/** Partial bytes never become installable until the whole file and package pass verification. */
internal fun verifiedUpdateDownload(
    partial: File, destination: File, release: AppRelease, maximum: Long,
    open: (Long) -> HttpURLConnection, checkActive: () -> Unit,
    onProgress: (Int) -> Unit, verifyPackage: (File) -> Unit,
): File {
    fun digest(file: File): String {
        val hash = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) { checkActive(); val n = input.read(buffer); if (n < 0) break; hash.update(buffer, 0, n) }
        }
        return hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    }
    fun valid(file: File) = file.isFile && file.length() in 1..maximum &&
        (release.apkSize == null || file.length() == release.apkSize) && digest(file).equals(release.sha256, true)
    if (valid(destination)) { verifyPackage(destination); onProgress(100); return destination }
    destination.delete()
    if (partial.length() > maximum) partial.delete()
    // A process can die after writing the last byte, before finalizing. Avoid
    // requesting an unsatisfiable range and verify the retained whole file.
    if (release.apkSize != null && partial.length() >= release.apkSize) {
        if (valid(partial)) {
            try { verifyPackage(partial) } catch (error: Exception) { partial.delete(); throw error }
            checkActive()
            if (!partial.renameTo(destination)) throw IOException("Could not finalize the downloaded update")
            onProgress(100); return destination
        }
        partial.delete()
    }
    var failure: IOException? = null
    repeat(3) {
        checkActive()
        var connection: HttpURLConnection? = null
        try {
            val offset = partial.length()
            connection = open(offset)
            val ranged = connection.responseCode == HttpURLConnection.HTTP_PARTIAL
            if (ranged) {
                val range = Regex("bytes (\\d+)-(\\d+)/(\\d+)").matchEntire(connection.getHeaderField("Content-Range").orEmpty())
                    ?: throw IOException("Update server returned an invalid range")
                val (start, end, total) = range.destructured
                if (start.toLong() != offset || end.toLong() < offset || end.toLong() >= total.toLong() || total.toLong() > maximum ||
                    (release.apkSize != null && total.toLong() != release.apkSize)) throw IOException("Update range does not match its manifest")
            } else if (connection.responseCode != HttpURLConnection.HTTP_OK) throw IOException("Update server did not return an APK")
            val expected = release.apkSize ?: connection.contentLengthLong.takeIf { it > 0 }?.let { it + if (ranged) offset else 0 }
            if (expected != null && expected > maximum) throw IOException("Update is larger than the allowed download size")
            var total = if (ranged) offset else 0L
            connection.inputStream.buffered().use { input ->
                java.io.FileOutputStream(partial, ranged).buffered().use { output ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        checkActive(); val read = input.read(buffer); if (read < 0) break
                        total += read
                        if (total > maximum) throw IOException("Update is larger than the allowed download size")
                        output.write(buffer, 0, read)
                        onProgress(expected?.let { ((total * 100) / it).coerceIn(0, 99).toInt() } ?: 0)
                    }
                }
            }
            checkActive()
            if (expected != null && total != expected) throw IOException("Update download interrupted; tap to resume")
            if (!valid(partial)) { partial.delete(); throw UpdateIntegrityFailure("Update checksum verification failed") }
            try { verifyPackage(partial) } catch (error: Exception) { partial.delete(); throw UpdateIntegrityFailure(error.message ?: "Invalid update package") }
            checkActive()
            if (!partial.renameTo(destination)) throw IOException("Could not finalize the downloaded update")
            onProgress(100)
            return destination
        } catch (cancelled: UpdateDownloadCancelled) { if (cancelled.discardPartial) partial.delete(); throw cancelled }
        catch (invalid: UpdateIntegrityFailure) { throw invalid }
        catch (error: IOException) { failure = error }
        finally { connection?.disconnect() }
    }
    throw failure ?: IOException("Update download interrupted; tap to resume")
}

private class UpdateIntegrityFailure(message: String) : IOException(message)
