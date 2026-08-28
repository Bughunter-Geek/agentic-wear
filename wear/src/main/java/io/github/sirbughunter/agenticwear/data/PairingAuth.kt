package io.github.sirbughunter.agenticwear.data

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

class PairingAuthenticator private constructor(
    val pairId: String,
    private val secret: ByteArray,
) {
    fun createProof(role: String, bridgePublicKey: String, watchPublicKey: String): String {
        require(role == "bridge" || role == "watch") { "Unknown pairing role" }
        val signature = Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(secret, "HmacSHA256"))
            doFinal(transcript(role, bridgePublicKey, watchPublicKey))
        }
        return Base64.getUrlEncoder().withoutPadding().encodeToString(signature)
    }

    fun verifyProof(role: String, bridgePublicKey: String, watchPublicKey: String, proof: String): Boolean {
        if (!PROOF.matches(proof)) return false
        val supplied = runCatching { Base64.getUrlDecoder().decode(proof) }.getOrNull() ?: return false
        val expected = Base64.getUrlDecoder().decode(createProof(role, bridgePublicKey, watchPublicKey))
        return MessageDigest.isEqual(expected, supplied)
    }

    fun clear() = secret.fill(0)

    private fun transcript(role: String, bridgePublicKey: String, watchPublicKey: String): ByteArray =
        "agentic-wear-pair-v2\n$pairId\n$role\n$bridgePublicKey\n$watchPublicKey"
            .toByteArray(StandardCharsets.UTF_8)

    companion object {
        private const val ITERATIONS = 120_000
        private val CODE = Regex("^[A-HJ-NP-Z2-9]{8}$")
        private val PROOF = Regex("^[A-Za-z0-9_-]{43}$")
        private val PAIRING_SALT = "agentic-wear-pair-auth-v2".toByteArray(StandardCharsets.UTF_8)
        private val PAIR_ID_DOMAIN = "agentic-wear-pair-id-v2\u0000".toByteArray(StandardCharsets.UTF_8)

        fun fromCode(value: String): PairingAuthenticator {
            val code = value.uppercase().filter(Char::isLetterOrDigit)
            require(CODE.matches(code)) { "Pairing codes contain eight characters" }
            val password = code.toCharArray()
            val spec = PBEKeySpec(password, PAIRING_SALT, ITERATIONS, 256)
            password.fill('\u0000')
            val secret = try {
                SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            } finally {
                spec.clearPassword()
            }
            val pairIdBytes = MessageDigest.getInstance("SHA-256").run {
                update(PAIR_ID_DOMAIN)
                digest(secret)
            }
            val pairId = Base64.getUrlEncoder().withoutPadding().encodeToString(pairIdBytes)
            pairIdBytes.fill(0)
            return PairingAuthenticator(pairId, secret)
        }
    }
}
