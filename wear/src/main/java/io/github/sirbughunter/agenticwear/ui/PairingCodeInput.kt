package io.github.sirbughunter.agenticwear.ui

internal fun sanitizePairingCodeInput(value: String): String {
    val uppercase = value.uppercase()
    val characters = uppercase.filter(Char::isLetterOrDigit).take(8)
    val hasExpectedDash = uppercase.indexOf('-') == 4
    return if (hasExpectedDash) {
        "${characters.take(4)}-${characters.drop(4)}"
    } else {
        characters
    }
}

internal fun normalizePairingCodeInput(value: String): String =
    value.filter(Char::isLetterOrDigit).take(8)

private val pairingCodePattern = Regex("(?i)(?<![A-Z2-9])[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}(?![A-Z2-9])")

internal fun extractPairingCode(value: String): String? =
    pairingCodePattern.find(value)?.value?.let(::sanitizePairingCodeInput)
