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
 @Test fun `public routes cannot enter private paths including encoded redirects`() {
  assertTrue(publicUpdateUrlAllowed(URL("https://github.com/owner/repo/releases/download/v1/agentic-wear.apk")))
  assertFalse(publicUpdateUrlAllowed(URL("https://relay.example/v1/pairs/any/private-update/manifest")))
  assertFalse(publicUpdateUrlAllowed(URL("https://relay.example/%76%31/pairs/any/private-update/manifest")))
 }
 @Test fun `private cached or downloaded releases must remain unexpired and hash scoped`() {
  val hash="a".repeat(64); val apk=URL("https://relay.example/v1/pairs/"+"A".repeat(43)+"/private-update/apk/$hash")
  assertTrue(privateUpdateReleaseAllowed(apk,hash,101,100))
  assertFalse(privateUpdateReleaseAllowed(apk,hash,100,100))
  assertFalse(privateUpdateReleaseAllowed(apk,hash,null,100))
  assertFalse(privateUpdateReleaseAllowed(apk,"b".repeat(64),101,100))
 }
}
