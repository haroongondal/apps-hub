package expo.modules.designmedia

import expo.modules.designmedia.applink.SiblingPackages
import expo.modules.designmedia.core.DeputyProposal
import expo.modules.designmedia.core.NexusShare
import expo.modules.designmedia.core.TrustedStart
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HandoffTrustTest {
  @Test fun aRefusedSiblingIsNeverStarted() {
    var started = false
    assertFalse(TrustedStart.begin({ false }) { started = true })
    assertFalse(started)
  }

  @Test fun aTrustedSiblingIsStarted() {
    var started = false
    assertTrue(TrustedStart.begin({ true }) { started = true })
    assertTrue(started)
  }

  @Test fun theSiblingsAreTheSharedTableEntries() {
    assertEquals(SiblingPackages.DEPUTY, DeputyProposal.DEPUTY_PACKAGE)
    assertEquals(SiblingPackages.NEXUS, NexusShare.PACKAGE)
  }

  // trustedActivity needs a real PackageManager, so a source scan holds the glue: both hand-offs check first, only Nexus's share screen skips the link permission.
  @Test fun bothHandoffsCheckTheTargetBeforeStarting() {
    val src = File(requireNotNull(System.getProperty("module.src")), "expo/modules/designmedia/android/Handoffs.kt").readText()
    assertEquals(2, Regex("AppLinkTarget\\.trustedActivity\\(").findAll(src).count())
    assertEquals(1, Regex("requireLinkPermission = false").findAll(src).count())
    assertEquals(2, Regex("TrustedStart\\.begin\\(").findAll(src).count())
    assertTrue(src.indexOf("trustedActivity(activity, intent)") < src.indexOf("startActivityForResult"))
  }
}
