package io.github.sirbughunter.agenticwear.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyPair
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class CryptoBox(context: Context) {
    private val keyPrefs = context.applicationContext.getSharedPreferences(
        "agentic_wear_software_ecdh",
        Context.MODE_PRIVATE,
    )

    fun publicKeyBase64(): String = AndroidKeyStoreAccess.execute { keyStore ->
        Base64.encodeToString(loadOrCreatePairingKey(keyStore).public.encoded, Base64.NO_WRAP)
    }

    fun clearPairingKey() {
        AndroidKeyStoreAccess.execute { keyStore ->
            cachedPairingKey = null
            cachedDerivedKey = null
            keyPrefs.edit(commit = true) { clear() }
            if (keyStore.containsAlias(PRIVATE_KEY_WRAP_ALIAS)) {
                keyStore.deleteEntry(PRIVATE_KEY_WRAP_ALIAS)
            }
        }
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
        cachedDerivedKey?.let { (key, secret) ->
            if (key == cacheKey) return secret
        }
        return AndroidKeyStoreAccess.execute { keyStore ->
            cachedDerivedKey?.let { (key, secret) ->
                if (key == cacheKey) return@execute secret
            }
            val privateKey = loadOrCreatePairingKey(keyStore).private
            val peerPublicKey = Base64.decode(peerPublicKeyBase64, Base64.NO_WRAP)
            val sharedSecret = performSoftwareEcdh(privateKey, peerPublicKey)
            val salt = MessageDigest.getInstance("SHA-256")
                .digest("agentic-wear-v1:$pairId".toByteArray(StandardCharsets.UTF_8))
            val derivedBytes = hkdf(sharedSecret, salt, "relay-e2ee".toByteArray(), 32)
            sharedSecret.fill(0)
            salt.fill(0)
            val derived = SecretKeySpec(derivedBytes, "AES")
            derivedBytes.fill(0)
            cachedDerivedKey = cacheKey to derived
            derived
        }
    }

    private fun loadOrCreatePairingKey(keyStore: KeyStore): KeyPair {
        cachedPairingKey?.let { return it }
        val version = keyPrefs.getInt(KEY_STORAGE_VERSION, 0)
        val publicKeyBase64 = keyPrefs.getString(KEY_PUBLIC_KEY, null)
        val wrappedPrivateKeyBase64 = keyPrefs.getString(KEY_WRAPPED_PRIVATE_KEY, null)
        if (version == SOFTWARE_KEY_STORAGE_VERSION && publicKeyBase64 != null && wrappedPrivateKeyBase64 != null) {
            return decryptPairingKey(keyStore, publicKeyBase64, wrappedPrivateKeyBase64).also {
                cachedPairingKey = it
            }
        }
        check(version == 0 && publicKeyBase64 == null && wrappedPrivateKeyBase64 == null) {
            "Stored watch pairing key is incomplete; disconnect and pair again"
        }
        return generateSoftwareEcKeyPair().also { keyPair ->
            storePairingKey(keyStore, keyPair)
            cachedPairingKey = keyPair
        }
    }

    private fun storePairingKey(keyStore: KeyStore, keyPair: KeyPair) {
        val publicKeyBase64 = Base64.encodeToString(keyPair.public.encoded, Base64.NO_WRAP)
        val privateKeyBytes = keyPair.private.encoded ?: error("Pairing private key cannot be encoded")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, privateKeyWrapKey(keyStore))
            updateAAD(privateKeyAad(publicKeyBase64))
        }
        val wrappedPrivateKey = try {
            cipher.doFinal(privateKeyBytes)
        } finally {
            privateKeyBytes.fill(0)
        }
        val nonce = cipher.iv
        require(nonce.size == GCM_NONCE_BYTES) { "Android Keystore returned an invalid GCM nonce" }
        keyPrefs.edit(commit = true) {
            clear()
            putInt(KEY_STORAGE_VERSION, SOFTWARE_KEY_STORAGE_VERSION)
            putString(KEY_PUBLIC_KEY, publicKeyBase64)
            putString(
                KEY_WRAPPED_PRIVATE_KEY,
                Base64.encodeToString(nonce + wrappedPrivateKey, Base64.NO_WRAP),
            )
        }
    }

    private fun decryptPairingKey(
        keyStore: KeyStore,
        publicKeyBase64: String,
        wrappedPrivateKeyBase64: String,
    ): KeyPair {
        val combined = Base64.decode(wrappedPrivateKeyBase64, Base64.NO_WRAP)
        require(combined.size > GCM_NONCE_BYTES + 16) { "Invalid stored pairing private key" }
        val privateKeyBytes = Cipher.getInstance("AES/GCM/NoPadding").run {
            init(
                Cipher.DECRYPT_MODE,
                privateKeyWrapKey(keyStore),
                GCMParameterSpec(128, combined.copyOfRange(0, GCM_NONCE_BYTES)),
            )
            updateAAD(privateKeyAad(publicKeyBase64))
            doFinal(combined.copyOfRange(GCM_NONCE_BYTES, combined.size))
        }
        return try {
            decodeSoftwareEcKeyPair(
                Base64.decode(publicKeyBase64, Base64.NO_WRAP),
                privateKeyBytes,
            )
        } finally {
            privateKeyBytes.fill(0)
        }
    }

    private fun privateKeyWrapKey(keyStore: KeyStore): SecretKey {
        (keyStore.getKey(PRIVATE_KEY_WRAP_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    PRIVATE_KEY_WRAP_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setUserAuthenticationRequired(false)
                    .build(),
            )
            generateKey()
        }
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
        extract.fill(0)
        previous.fill(0)
        return output
    }

    private fun privateKeyAad(publicKeyBase64: String): ByteArray =
        "agentic-wear-software-ecdh-v1|$publicKeyBase64".toByteArray(StandardCharsets.UTF_8)

    private fun aad(version: Int, id: String, sender: String, recipient: String, sentAt: Long): ByteArray =
        "$version|$id|$sender|$recipient|$sentAt".toByteArray(StandardCharsets.UTF_8)

    companion object {
        private const val PRIVATE_KEY_WRAP_ALIAS = "agentic_wear_pairing_wrap_v2"
        private const val KEY_STORAGE_VERSION = "storage_version"
        private const val KEY_PUBLIC_KEY = "public_key"
        private const val KEY_WRAPPED_PRIVATE_KEY = "wrapped_private_key"
        private const val SOFTWARE_KEY_STORAGE_VERSION = 1
        private const val GCM_NONCE_BYTES = 12
        private const val MAX_MESSAGE_AGE_MS = 24L * 60L * 60L * 1_000L
        private const val MAX_FUTURE_SKEW_MS = 5L * 60L * 1_000L
        private const val MAX_CIPHERTEXT_BYTES = 768 * 1_024
        private val secureRandom = SecureRandom()

        @Volatile
        private var cachedPairingKey: KeyPair? = null

        @Volatile
        private var cachedDerivedKey: Pair<String, SecretKeySpec>? = null
    }
}
