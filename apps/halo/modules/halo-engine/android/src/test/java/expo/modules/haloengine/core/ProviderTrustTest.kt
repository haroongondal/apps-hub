package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProviderTrustTest {
  @Test fun aMatchingPackageAndSignerIsAllowed() = assertTrue(ProviderTrust.allowed("com.haroon.deputy", "com.haroon.deputy", true))

  @Test fun aWrongPackageIsRefused() = assertFalse(ProviderTrust.allowed("com.haroon.deputy", "com.evil.deputy", true))

  @Test fun noProviderIsRefused() = assertFalse(ProviderTrust.allowed("com.haroon.deputy", null, true))

  @Test fun aSignerMismatchIsRefused() = assertFalse(ProviderTrust.allowed("com.haroon.deputy", "com.haroon.deputy", false))

  @Test fun anUnknownAuthorityIsRefused() {
    assertNull(ProviderTrust.expectedPackage("com.evil.applink"))
    assertFalse(ProviderTrust.allowed(null, "com.evil", true))
  }

  @Test fun everyShareHaloReadsHasItsOwnerInTheTable() {
    val owners = LinkShares.ALL.associate { it.authority to ProviderTrust.expectedPackage(it.authority) }
    assertEquals(
      mapOf(
        "com.haroon.netlens.applink" to "app.netlens",
        "com.haroon.opentunnel.applink" to "com.opentunnel.open_tunnel_vpn",
        "com.haroon.deputy.applink" to "com.haroon.deputy",
        "com.haroon.inflow.autopilot" to "com.haroon.inflow",
      ),
      owners,
    )
  }
}
