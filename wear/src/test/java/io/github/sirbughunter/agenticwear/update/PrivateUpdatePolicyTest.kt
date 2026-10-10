package io.github.sirbughunter.agenticwear.update
import java.net.URL
import org.junit.Assert.*
import org.junit.Test
class PrivateUpdatePolicyTest {
 @Test fun `credentials stay in their paired HTTPS update routes`() {
  val relay=URL("https://relay.example"); val pair="A".repeat(43)
  assertTrue(privateUpdateUrlAllowed(URL("https://relay.example/v1/pairs/$pair/private-update/manifest"),relay,pair))
  assertTrue(privateUpdateUrlAllowed(URL("https://relay.example/v1/pairs/$pair/private-update/apk/"+"a".repeat(64)),relay,pair))
  assertFalse(privateUpdateUrlAllowed(URL("https://elsewhere.example/v1/pairs/$pair/private-update/manifest"),relay,pair))
  assertFalse(privateUpdateUrlAllowed(URL("https://relay.example/v1/pairs/"+"B".repeat(43)+"/private-update/manifest"),relay,pair))
  assertFalse(privateUpdateUrlAllowed(URL("http://relay.example/v1/pairs/$pair/private-update/manifest"),relay,pair))
  assertFalse(privateUpdateUrlAllowed(URL("https://relay.example/v1/pairs/$pair/private-update/manifest?token=x"),relay,pair))
 }
}
