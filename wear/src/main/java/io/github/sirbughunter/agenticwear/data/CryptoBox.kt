package io.github.sirbughunter.agenticwear.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class CryptoBox {
    private val keyStore: KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    @Volatile
    private var cachedKey: Pair<String, SecretKeySpec>? = null

    fun publicKeyBase64(): String {
        ensurePairingKey()
        val publicKey = keyStore.getCertificate(PAIRING_ALIAS)?.publicKey
            ?: error("Pairing public key is unavailable")
        return Base64.encodeToString(publicKey.encoded, Base64.NO_WRAP)
    }

    fun clearPairingKey() {
        cachedKey = null
        if (keyStore.containsAlias(PAIRING_ALIAS)) keyStore.deleteEntry(PAIRING_ALIAS)
    }

    fun encrypt(pairId: String, peerPublicKeyBase64: String, plaintext: String): JSONObject {
        val messageId = java.util.UUID.randomUUID().toString()
        val sentAt = System.currentTimeMillis()
        val sender = "watch"
        val recipient = "bridge"
        val aad = aad(1, messageId, sender, recipient, sentAt)
        val nonce = ByteArray(12).also(secureRandom::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, deriveKey(pairId, peerPublicKeyBase64), GCMParameterSpec(128, nonce))
            updateAAD(aad)
        }
        val encrypted = cipher.doFinal(plaintext.toByteArray(StandardCharsets.UTF_8))
        return JSONObject()
            .put("version", 1)
            .put("messageId", messageId)
            .put("sender", sender)
            .put("recipient", recipient)
            .put("sentAt", sentAt)
            .put("nonce", Base64.encodeToString(nonce, Base64.NO_WRAP))
            .put("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
    }

    fun decrypt(pairId: String, peerPublicKeyBase64: String, envelope: JSONObject): JSONObject {
        require(envelope.optInt("version") == 1) { "Unsupported envelope version" }
        val messageId = envelope.getString("messageId")
        val sender = envelope.getString("sender")
        val recipient = envelope.getString("recipient")
        val sentAt = envelope.getLong("sentAt")
        require(sender == "bridge" && recipient == "watch") { "Unexpected envelope route" }
        val now = System.currentTimeMillis()
        require(sentAt <= now + MAX_FUTURE_SKEW_MS && now - sentAt < MAX_MESSAGE_AGE_MS) {
            "Envelope timestamp is outside the accepted window"
        }
        val nonce = Base64.decode(envelope.getString("nonce"), Base64.NO_WRAP)
        require(nonce.size == 12) { "Invalid nonce" }
        val encrypted = Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP)
        require(encrypted.size <= MAX_CIPHERTEXT_BYTES) { "Envelope is too large" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, deriveKey(pairId, peerPublicKeyBase64), GCMParameterSpec(128, nonce))
            updateAAD(aad(1, messageId, sender, recipient, sentAt))
        }
        return JSONObject(String(cipher.doFinal(encrypted), StandardCharsets.UTF_8))
    }

    private fun deriveKey(pairId: String, peerPublicKeyBase64: String): SecretKeySpec {
        val cacheKey = "$pairId:$peerPublicKeyBase64"
        cachedKey?.let { (key, secret) ->
            if (key == cacheKey) return secret
        }
        return synchronized(this) {
            cachedKey?.let { (key, secret) ->
                if (key == cacheKey) return secret
            }
            ensurePairingKey()
            val privateKey = keyStore.getKey(PAIRING_ALIAS, null)
                ?: error("Pairing private key is unavailable")
            val peerPublicKey = KeyFactory.getInstance("EC").generatePublic(
                X509EncodedKeySpec(Base64.decode(peerPublicKeyBase64, Base64.NO_WRAP)),
            )
            val sharedSecret = try {
                val agreement = try {
                    KeyAgreement.getInstance("ECDH", "AndroidKeyStore")
                } catch (_: Throwable) {
                    KeyAgreement.getInstance("ECDH")
                }
                agreement.run {
                    init(privateKey)
                    doPhase(peerPublicKey, true)
                    generateSecret()
                }
            } catch (error: Exception) {
                keyStore.load(null)
                val reloadedKey = keyStore.getKey(PAIRING_ALIAS, null) ?: throw error
                val agreement = KeyAgreement.getInstance("ECDH")
                agreement.run {
                    init(reloadedKey)
                    doPhase(peerPublicKey, true)
                    generateSecret()
                }
            }
            val salt = MessageDigest.getInstance("SHA-256")
                .digest("agentic-wear-v1:$pairId".toByteArray(StandardCharsets.UTF_8))
            val derived = SecretKeySpec(hkdf(sharedSecret, salt, "relay-e2ee".toByteArray(), 32), "AES")
            cachedKey = cacheKey to derived
            derived
        }
    }

    private fun ensurePairingKey() {
        if (keyStore.containsAlias(PAIRING_ALIAS)) return
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
            initialize(
                KeyGenParameterSpec.Builder(PAIRING_ALIAS, KeyProperties.PURPOSE_AGREE_KEY)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setUserAuthenticationRequired(false)
                    .build(),
            )
        }.generateKeyPair()
    }

    private fun hkdf(input: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val extract = Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(salt, "HmacSHA256"))
            doFinal(input)
        }
        val output = ByteArray(length)
        var previous = ByteArray(0)
        var offset = 0
        var counter = 1
        while (offset < length) {
            previous = Mac.getInstance("HmacSHA256").run {
                init(SecretKeySpec(extract, "HmacSHA256"))
                update(previous)
                update(info)
                update(counter.toByte())
                doFinal()
            }
            val count = minOf(previous.size, length - offset)
            previous.copyInto(output, offset, 0, count)
            offset += count
            counter += 1
        }
        return output
    }

    private fun aad(version: Int, id: String, sender: String, recipient: String, sentAt: Long): ByteArray =
        "$version|$id|$sender|$recipient|$sentAt".toByteArray(StandardCharsets.UTF_8)

    companion object {
        private const val PAIRING_ALIAS = "agentic_wear_pairing_v1"
        private const val MAX_MESSAGE_AGE_MS = 24L * 60L * 60L * 1_000L
        private const val MAX_FUTURE_SKEW_MS = 5L * 60L * 1_000L
        private const val MAX_CIPHERTEXT_BYTES = 768 * 1_024
        private val secureRandom = SecureRandom()
    }
}
