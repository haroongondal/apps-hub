package expo.modules.nexuslinks.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OpensTest {
  @Test fun onlyTheStoreAndAiHubCanBeOpened() {
    assertEquals("com.haroon.store", Opens.packageOf("store"))
    assertEquals("com.haroon.aihub", Opens.packageOf("ai-hub"))
    assertNull(Opens.packageOf("strongroom"))
    assertNull(Opens.packageOf("com.haroon.strongroom"))
    assertEquals(setOf("store", "ai-hub"), Opens.APPS.keys)
  }

  @Test fun opensWhenTheLaunchComponentIsTheExpectedPackageSignedLikeNexus() {
    for (pkg in Opens.APPS.values) assertTrue(Opens.trusted(pkg, pkg, true))
  }

  @Test fun refusesAnotherPackageAnUnsignedMatchAndANotInstalledApp() {
    assertFalse(Opens.trusted("com.haroon.aihub", "com.evil.aihub", true))
    assertFalse(Opens.trusted("com.haroon.aihub", "com.haroon.aihub", false))
    assertFalse(Opens.trusted("com.haroon.aihub", null, true))
    assertFalse(Opens.trusted("com.haroon.strongroom", "com.haroon.strongroom", true))
  }
}
