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

    fun read(): Pairing? {
        cachedPairing?.let { return it }
        return AndroidKeyStoreAccess.execute { keyStore ->
            cachedPairing?.let { return@execute it }
            if (prefs.getInt(KEY_PROTOCOL_VERSION, 0) != PROTOCOL_VERSION) return@execute null
            val relayUrl = prefs.getString(KEY_RELAY_URL, null) ?: return@execute null
            val pairId = prefs.getString(KEY_PAIR_ID, null) ?: return@execute null
            val bridgePublicKey = prefs.getString(KEY_BRIDGE_PUBLIC_KEY, null) ?: return@execute null
            val encryptedCredential = prefs.getString(KEY_CREDENTIAL, null) ?: return@execute null
            val pairing = Pairing(
                relayUrl = relayUrl,
                pairId = pairId,
                watchCredential = decrypt(keyStore, encryptedCredential),
                bridgePublicKey = bridgePublicKey,
            )
            cachedPairing = pairing
            pairing
        }
    }

    fun write(pairing: Pairing) {
        AndroidKeyStoreAccess.execute { keyStore ->
            val encryptedCredential = encrypt(keyStore, pairing.watchCredential)
            prefs.edit(commit = true) {
                putInt(KEY_PROTOCOL_VERSION, PROTOCOL_VERSION)
                putString(KEY_RELAY_URL, pairing.relayUrl)
                putString(KEY_PAIR_ID, pairing.pairId)
                putString(KEY_BRIDGE_PUBLIC_KEY, pairing.bridgePublicKey)
                putString(KEY_CREDENTIAL, encryptedCredential)
            }
            cachedPairing = pairing
        }
    }

    fun clear() {
        AndroidKeyStoreAccess.serialized {
            cachedPairing = null
            prefs.edit(commit = true) { clear() }
        }
    }

    private fun encrypt(keyStore: KeyStore, value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, secretKey(keyStore))
        }
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val nonce = cipher.iv
        require(nonce.size == 12) { "Android Keystore returned an invalid GCM nonce" }
        return Base64.encodeToString(nonce + encrypted, Base64.NO_WRAP)
    }

    private fun decrypt(keyStore: KeyStore, value: String): String {
        val combined = Base64.decode(value, Base64.NO_WRAP)
        require(combined.size > 28) { "Invalid stored credential" }
        val plaintext = Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, secretKey(keyStore), GCMParameterSpec(128, combined.copyOfRange(0, 12)))
            doFinal(combined.copyOfRange(12, combined.size))
        }
        return String(plaintext, Charsets.UTF_8)
    }

    private fun secretKey(keyStore: KeyStore): SecretKey {
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

        @Volatile
        private var cachedPairing: Pairing? = null
    }
}
