package expo.modules.aihubclient.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HubTrustTest {
  private val real = HubService("com.haroon.aihub", "expo.modules.aihubcore.android.AiHubService", "com.haroon.permission.AI_HUB", true)

  private fun kind(installed: Boolean = true, sameSigner: Boolean = true, services: List<HubService> = listOf(real)) =
    HubTrust.problem(installed, sameSigner, services)?.kind

  @Test fun theRealHubSignedLikeUsIsTrusted() {
    assertNull(kind())
  }

  @Test fun aMissingHubIsHubMissing() {
    assertEquals(Kinds.HUB_MISSING, kind(installed = false, sameSigner = false, services = emptyList()))
    assertEquals(Kinds.HUB_MISSING, kind(services = emptyList()))
  }

  @Test fun aSquatterSignedByAnotherKeyIsNotAllowedWhateverItDeclares() {
    assertEquals(Kinds.NOT_ALLOWED, kind(sameSigner = false))
    assertEquals(Kinds.NOT_ALLOWED, kind(sameSigner = false, services = emptyList()))
  }

  @Test fun aServiceWithoutTheGuardOrNotExportedIsNotAllowed() {
    assertEquals(Kinds.NOT_ALLOWED, kind(services = listOf(real.copy(permission = null))))
    assertEquals(Kinds.NOT_ALLOWED, kind(services = listOf(real.copy(permission = "com.haroon.permission.AUTOPILOT"))))
    assertEquals(Kinds.NOT_ALLOWED, kind(services = listOf(real.copy(exported = false))))
    assertEquals(Kinds.NOT_ALLOWED, kind(services = listOf(real.copy(pkg = "com.evil.aihub"))))
  }

  @Test fun twoServicesForTheActionAreNotAllowed() {
    assertEquals(Kinds.NOT_ALLOWED, kind(services = listOf(real, real.copy(name = "expo.modules.aihubcore.android.Other"))))
  }

  @Test fun theConnectedComponentMustBeTheResolvedOneAndSignedLikeUs() {
    assertTrue(HubTrust.connectedIsTrusted(real, real.pkg, real.name, sameSigner = true))
    assertFalse(HubTrust.connectedIsTrusted(real, real.pkg, real.name, sameSigner = false))
    assertFalse(HubTrust.connectedIsTrusted(real, "com.evil.aihub", real.name, sameSigner = true))
    assertFalse(HubTrust.connectedIsTrusted(real, real.pkg, "x.Other", sameSigner = true))
    assertFalse(HubTrust.connectedIsTrusted(real, null, null, sameSigner = false))
  }
}
