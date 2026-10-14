package io.github.sirbughunter.agenticwear.update
import java.net.URL

/** Never send a pairing credential outside its exact HTTPS pair-scoped update route. */
internal fun privateUpdateUrlAllowed(candidate: URL, relay: URL, pairId: String): Boolean {
    if (candidate.protocol != "https" || relay.protocol != "https" || candidate.userInfo != null || candidate.query != null || candidate.ref != null) return false
    if (!candidate.host.equals(relay.host, ignoreCase = true) || candidate.port != relay.port) return false
    if (!pairId.matches(Regex("[A-Za-z0-9_-]{43}"))) return false
    val prefix = relay.path.trimEnd('/') + "/v1/pairs/$pairId/private-update/"
    return candidate.path == prefix + "manifest" || candidate.path.matches(Regex(Regex.escape(prefix) + "apk/[a-f0-9]{64}"))
}

/** Public sources never request the credential-bearing pair routes, including encoded paths. */
internal fun publicUpdateUrlAllowed(candidate: URL): Boolean {
    val path = candidate.path.lowercase()
    return !path.contains("/v1/pairs/") && !path.contains("/private-update/") && !path.contains("%")
}

internal fun privateUpdateReleaseAllowed(apk: URL, sha256: String, expiresAt: Long?, now: Long): Boolean =
    expiresAt != null && expiresAt > now && sha256.matches(Regex("[a-f0-9]{64}")) && apk.path.endsWith("/apk/$sha256")
