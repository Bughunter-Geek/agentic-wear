package io.github.sirbughunter.agenticwear.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class Pairing(
    val relayUrl: String,
    val pairId: String,
    val watchCredential: String,
    val bridgePublicKey: String,
)

class SecurePairingStore(context: Context) {
    private val prefs = context.getSharedPreferences("agentic_wear_pairing", Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    @Volatile
    private var cachedPairing: Pairing? = null

    fun read(): Pairing? {
        cachedPairing?.let { return it }
        return synchronized(this) {
            cachedPairing?.let { return it }
            if (prefs.getInt(KEY_PROTOCOL_VERSION, 0) != PROTOCOL_VERSION) return null
            val relayUrl = prefs.getString(KEY_RELAY_URL, null) ?: return null
            val pairId = prefs.getString(KEY_PAIR_ID, null) ?: return null
            val bridgePublicKey = prefs.getString(KEY_BRIDGE_PUBLIC_KEY, null) ?: return null
            val encryptedCredential = prefs.getString(KEY_CREDENTIAL, null) ?: return null
            val pairing = runCatching {
                Pairing(relayUrl, pairId, decrypt(encryptedCredential), bridgePublicKey)
            }.getOrNull()
            cachedPairing = pairing
            pairing
        }
    }

    fun write(pairing: Pairing) {
        prefs.edit(commit = true) {
            putInt(KEY_PROTOCOL_VERSION, PROTOCOL_VERSION)
            putString(KEY_RELAY_URL, pairing.relayUrl)
            putString(KEY_PAIR_ID, pairing.pairId)
            putString(KEY_BRIDGE_PUBLIC_KEY, pairing.bridgePublicKey)
            putString(KEY_CREDENTIAL, encrypt(pairing.watchCredential))
        }
        cachedPairing = pairing
    }

    fun clear() {
        cachedPairing = null
        prefs.edit(commit = true) { clear() }
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, secretKey())
        }
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val nonce = cipher.iv
        require(nonce.size == 12) { "Android Keystore returned an invalid GCM nonce" }
        return Base64.encodeToString(nonce + encrypted, Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String {
        val combined = Base64.decode(value, Base64.NO_WRAP)
        require(combined.size > 28) { "Invalid stored credential" }
        return try {
            performDecrypt(combined)
        } catch (_: Exception) {
            keyStore.load(null)
            performDecrypt(combined)
        }
    }

    private fun performDecrypt(combined: ByteArray): String {
        val plaintext = Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, combined.copyOfRange(0, 12)))
            doFinal(combined.copyOfRange(12, combined.size))
        }
        return String(plaintext, Charsets.UTF_8)
    }

    private fun secretKey(): SecretKey {
        (keyStore.getKey(SECRETS_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    SECRETS_ALIAS,
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

    companion object {
        private const val SECRETS_ALIAS = "agentic_wear_secrets_v1"
        private const val KEY_RELAY_URL = "relay_url"
        private const val KEY_PAIR_ID = "pair_id"
        private const val KEY_CREDENTIAL = "watch_credential"
        private const val KEY_BRIDGE_PUBLIC_KEY = "bridge_public_key"
        private const val KEY_PROTOCOL_VERSION = "protocol_version"
        private const val PROTOCOL_VERSION = 2
    }
}
