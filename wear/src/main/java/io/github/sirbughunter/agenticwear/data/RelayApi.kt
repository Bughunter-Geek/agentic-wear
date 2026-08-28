package io.github.sirbughunter.agenticwear.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.delay

data class PairingResult(
    val pairId: String,
    val watchCredential: String,
    val bridgePublicKey: String,
)

class RelayApi {
    suspend fun completePairing(
        relayUrl: String,
        authenticator: PairingAuthenticator,
        watchPublicKey: String,
        fcmInstallationId: String?,
    ): PairingResult {
        val normalizedUrl = RelayUrlPolicy.normalize(relayUrl)
        val pairingBody = JSONObject()
            .put("pairId", authenticator.pairId)
            .put("watchPublicKey", watchPublicKey)
        fcmInstallationId?.let { pairingBody.put("fcmInstallationId", it) }
        val response = request(
            url = "$normalizedUrl/v1/pair/complete",
            method = "POST",
            body = pairingBody.toString(),
        )
        val returnedPairId = response.getString("pairId")
        require(returnedPairId == authenticator.pairId) { "Relay returned a different pairing identifier" }
        val watchCredential = response.getString("watchCredential")
        val bridgePublicKey = response.getString("bridgePublicKey")
        val watchProof = authenticator.createProof("watch", bridgePublicKey, watchPublicKey)
        request(
            url = "$normalizedUrl/v1/pairs/${encodePath(returnedPairId)}/confirm-watch",
            method = "POST",
            bearer = watchCredential,
            body = JSONObject().put("watchProof", watchProof).toString(),
        )
        val deadline = System.currentTimeMillis() + PAIR_CONFIRMATION_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            val status = request(
                url = "$normalizedUrl/v1/pairs/${encodePath(returnedPairId)}/watch-status",
                method = "GET",
                bearer = watchCredential,
            )
            val bridgeProof = status.optString("bridgeProof").takeIf(String::isNotBlank)
            if (status.optBoolean("paired") && bridgeProof != null) {
                require(authenticator.verifyProof("bridge", bridgePublicKey, watchPublicKey, bridgeProof)) {
                    "Pairing authentication failed: the relay presented an invalid bridge proof"
                }
                return PairingResult(returnedPairId, watchCredential, bridgePublicKey)
            }
            delay(400)
        }
        error("Timed out waiting for the bridge to authenticate pairing")
    }

    suspend fun sendToBridge(pairing: Pairing, envelope: JSONObject) {
        request(
            url = "${pairing.relayUrl}/v1/pairs/${encodePath(pairing.pairId)}/to-bridge",
            method = "POST",
            bearer = pairing.watchCredential,
            body = envelope.toString(),
        )
    }

    suspend fun fetchInbox(pairing: Pairing): List<JSONObject> = request(
        url = "${pairing.relayUrl}/v1/pairs/${encodePath(pairing.pairId)}/inbox",
        method = "GET",
        bearer = pairing.watchCredential,
    ).optJSONArray("messages").toObjectList()

    suspend fun acknowledge(pairing: Pairing, messageIds: List<String>) {
        if (messageIds.isEmpty()) return
        request(
            url = "${pairing.relayUrl}/v1/pairs/${encodePath(pairing.pairId)}/ack",
            method = "POST",
            bearer = pairing.watchCredential,
            body = JSONObject().put("messageIds", JSONArray(messageIds.take(50))).toString(),
        )
    }

    suspend fun updateFcmRegistration(pairing: Pairing, installationId: String) {
        request(
            url = "${pairing.relayUrl}/v1/pairs/${encodePath(pairing.pairId)}/registration",
            method = "PUT",
            bearer = pairing.watchCredential,
            body = JSONObject().put("fcmInstallationId", installationId).toString(),
        )
    }

    private suspend fun request(
        url: String,
        method: String,
        bearer: String? = null,
        body: String? = null,
    ): JSONObject = withContext(Dispatchers.IO) {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 8_000
            connection.readTimeout = 20_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", "OpenAI File Downloader, XaiImageApiFetch/1.0")
            bearer?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            body?.let { value ->
                val bytes = value.toByteArray(Charsets.UTF_8)
                require(bytes.size <= MAX_REQUEST_BYTES) { "Request is too large" }
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.let { BufferedInputStream(it).use(::readBounded) }
                ?: ByteArray(0)
            require(bytes.size <= MAX_RESPONSE_BYTES) { "Relay response is too large" }
            val text = String(bytes, Charsets.UTF_8)
            if (status !in 200..299) {
                val detail = runCatching { JSONObject(text).optString("error") }.getOrNull()
                throw RelayException(status, detail?.takeIf(String::isNotBlank) ?: "Relay request failed")
            }
            if (text.isBlank()) JSONObject() else JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }

    private fun encodePath(value: String): String = java.net.URLEncoder.encode(value, Charsets.UTF_8.name())
        .replace("+", "%20")

    private fun JSONArray?.toObjectList(): List<JSONObject> = buildList {
        val array = this@toObjectList ?: return@buildList
        for (index in 0 until minOf(array.length(), 50)) array.optJSONObject(index)?.let(::add)
    }

    private fun readBounded(input: BufferedInputStream): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1_024)
        while (output.size() <= MAX_RESPONSE_BYTES) {
            val count = input.read(buffer, 0, minOf(buffer.size, MAX_RESPONSE_BYTES + 1 - output.size()))
            if (count < 0) break
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    companion object {
        private const val MAX_REQUEST_BYTES = 2_500_000
        private const val MAX_RESPONSE_BYTES = 768 * 1_024
        private const val PAIR_CONFIRMATION_TIMEOUT_MS = 30_000L
    }
}

class RelayException(val status: Int, message: String) : Exception(message)
