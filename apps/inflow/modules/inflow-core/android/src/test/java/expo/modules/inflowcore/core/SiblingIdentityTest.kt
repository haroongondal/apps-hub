package expo.modules.inflowcore.core

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SiblingIdentityTest {
  @Test fun theDecision() {
    assertTrue(SiblingIdentity.allowed("app.netlens", "app.netlens", true))
    assertFalse("wrong package", SiblingIdentity.allowed("app.netlens", "com.evil.netlens", true))
    assertFalse("no provider", SiblingIdentity.allowed("app.netlens", null, true))
    assertFalse("other key", SiblingIdentity.allowed("app.netlens", "app.netlens", false))
    assertFalse("unknown package", SiblingIdentity.allowed(null, "app.netlens", true))
    assertFalse(SiblingIdentity.allowed(null, null, true))
  }

  @Test fun trustedAsksTheTableThenTheOwnerThenTheKey() {
    val asked = mutableListOf<String>()
    val owner = ProviderOwner { asked += "owner:$it"; SiblingIdentity.PACKAGES[it] }
    val key = SameKey { asked += "key:$it"; true }
    assertTrue(SiblingIdentity.trusted("com.haroon.deputy.applink", owner, key))
    assertEquals(listOf("owner:com.haroon.deputy.applink", "key:com.haroon.deputy"), asked)
    asked.clear()
    assertFalse(SiblingIdentity.trusted("com.haroon.unknown.applink", owner, key))
    assertEquals(emptyList<String>(), asked)
    assertFalse(SiblingIdentity.trusted("com.haroon.deputy.applink", { "com.evil" }, key))
    assertEquals(emptyList<String>(), asked)
    assertFalse(SiblingIdentity.trusted("com.haroon.deputy.applink", owner) { throw RuntimeException("NameNotFoundException") })
    assertFalse(SiblingIdentity.trusted("com.haroon.deputy.applink", { throw SecurityException() }, key))
  }

  @Test fun theFourReadersAreInTheTableWithTheirPackages() {
    val read = listOf(BriefingReaders.HOME_URI, BriefingReaders.CARDS_URI, BriefingReaders.TASKS_URI, BriefingReaders.NEXUS_URI).map { SiblingIdentity.PACKAGES[BriefingReaders.authority(it)] }
    assertEquals(listOf("app.netlens", "com.haroon.strongroom", "com.haroon.deputy", "com.haroon.pdfeditor"), read)
  }

  @Test fun theTableCoversEveryLinkAuthorityButInflowsOwn() {
    // Gradle runs module unit tests from the module's android/ folder: five levels up is the repo root.
    val ts = File("../../../../../packages/app-link-contract/src/health.ts").readText()
    val block = ts.substringAfter("HEALTH_AUTHORITIES = {").substringBefore("}")
    val authorities = Regex("'(com\\.haroon\\.[a-z.]+)'").findAll(block).map { it.groupValues[1] }.toSet()
    assertEquals(authorities - "com.haroon.inflow.autopilot", SiblingIdentity.PACKAGES.keys)
  }
}
