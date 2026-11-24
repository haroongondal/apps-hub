package expo.modules.haloengine.core

import expo.modules.haloengine.applink.AppLinkTarget
import expo.modules.haloengine.applink.SiblingPackages
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareOwnersTest {
  private val row: RawRow = mapOf("on" to 1L)
  private val share = LinkShares.SHIELD

  // The real reader passes AppLinkTarget.trustedProvider; here the decision is built from the same decide() it ends in.
  private fun readWith(resolved: String?, signed: Boolean, hits: IntArray = IntArray(1)): List<RawRow> =
    ShareOwners.read(share, { _, owner -> AppLinkTarget.decide(owner, resolved, signed) == AppLinkTarget.Decision.Trusted }) { hits[0]++; listOf(row) }

  @Test fun everyShareHaloReadsHasItsOwnerInSiblingPackages() {
    for (s in LinkShares.ALL) assertTrue(s.authority, ShareOwners.OWNER[s.authority] in SiblingPackages.ALL.values)
    assertEquals(
      mapOf(
        "com.haroon.netlens.applink" to "app.netlens",
        "com.haroon.opentunnel.applink" to "com.opentunnel.open_tunnel_vpn",
        "com.haroon.deputy.applink" to "com.haroon.deputy",
        "com.haroon.inflow.autopilot" to "com.haroon.inflow",
      ),
      LinkShares.ALL.associate { it.authority to ShareOwners.OWNER[it.authority] },
    )
  }

  @Test fun aTrustedOwnerIsQueried() = assertEquals(listOf(row), readWith("com.opentunnel.open_tunnel_vpn", true))

  @Test fun aSpoofedWrongPackageIsNotQueried() {
    val hits = IntArray(1)
    assertEquals(emptyList<RawRow>(), readWith("com.evil.tunnel", true, hits))
    assertEquals(0, hits[0])
  }

  @Test fun aSignatureMismatchIsNotQueried() {
    val hits = IntArray(1)
    assertEquals(emptyList<RawRow>(), readWith("com.opentunnel.open_tunnel_vpn", false, hits))
    assertEquals(0, hits[0])
  }

  @Test fun aNotInstalledOwnerIsNotQueried() {
    val hits = IntArray(1)
    assertEquals(emptyList<RawRow>(), readWith(null, true, hits))
    assertEquals(0, hits[0])
  }

  @Test fun anAuthorityWithNoOwnerIsNotQueried() {
    val hits = IntArray(1)
    val stray = ReadShare("x", "com.evil.applink", "x", emptyList(), 1)
    assertEquals(emptyList<RawRow>(), ShareOwners.read(stray, { _, _ -> true }) { hits[0]++; listOf(row) })
    assertEquals(0, hits[0])
  }
}
