package io.github.sirbughunter.agenticwear.data

import java.security.KeyFactory
import java.security.AlgorithmParameters
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Provider
import java.security.Security
import java.security.Signature
import java.security.interfaces.ECKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.KeyAgreement

internal fun generateSoftwareEcKeyPair(): KeyPair {
    val generator = KeyPairGenerator.getInstance("EC", softwareProvider("KeyPairGenerator", "EC"))
    generator.initialize(ECGenParameterSpec("secp256r1"))
    return generator.generateKeyPair().also(::requireValidSoftwareKeyPair)
}

internal fun decodeSoftwareEcKeyPair(publicEncoded: ByteArray, privateEncoded: ByteArray): KeyPair {
    val factory = KeyFactory.getInstance("EC", softwareProvider("KeyFactory", "EC"))
    return KeyPair(
        factory.generatePublic(X509EncodedKeySpec(publicEncoded)),
        factory.generatePrivate(PKCS8EncodedKeySpec(privateEncoded)),
    ).also(::requireValidSoftwareKeyPair)
}

internal fun performSoftwareEcdh(privateKey: PrivateKey, peerPublicEncoded: ByteArray): ByteArray {
    requireP256(privateKey)
    val factory = KeyFactory.getInstance("EC", softwareProvider("KeyFactory", "EC"))
    val peerPublicKey = factory.generatePublic(X509EncodedKeySpec(peerPublicEncoded))
    requireP256(peerPublicKey)
    return KeyAgreement.getInstance("ECDH", softwareProvider("KeyAgreement", "ECDH")).run {
        init(privateKey)
        doPhase(peerPublicKey, true)
        generateSecret()
    }
}

private fun requireValidSoftwareKeyPair(keyPair: KeyPair) {
    requireP256(keyPair.public)
    requireP256(keyPair.private)
    val probe = "agentic-wear-key-pair-check".toByteArray()
    val signature = Signature.getInstance(
        "SHA256withECDSA",
        softwareProvider("Signature", "SHA256withECDSA"),
    ).run {
        initSign(keyPair.private)
        update(probe)
        sign()
    }
    val valid = Signature.getInstance(
        "SHA256withECDSA",
        softwareProvider("Signature", "SHA256withECDSA"),
    ).run {
        initVerify(keyPair.public)
        update(probe)
        verify(signature)
    }
    require(valid) { "Stored pairing public and private keys do not match" }
}

private fun requireP256(key: java.security.Key) {
    val ecKey = key as? ECKey ?: error("Pairing key is not an EC key")
    val expected = p256Parameters
    require(
        ecKey.params.curve == expected.curve &&
            ecKey.params.generator == expected.generator &&
            ecKey.params.order == expected.order &&
            ecKey.params.cofactor == expected.cofactor,
    ) {
        "Pairing key is not P-256"
    }
}

private val p256Parameters by lazy {
    AlgorithmParameters.getInstance("EC", softwareProvider("AlgorithmParameters", "EC")).run {
        init(ECGenParameterSpec("secp256r1"))
        getParameterSpec(ECParameterSpec::class.java)
    }
}

private fun softwareProvider(service: String, algorithm: String): Provider =
    Security.getProviders().firstOrNull { provider ->
        provider.name != ANDROID_KEY_STORE_PROVIDER && provider.getService(service, algorithm) != null
    } ?: error("No software $algorithm provider is available")

private const val ANDROID_KEY_STORE_PROVIDER = "AndroidKeyStore"
