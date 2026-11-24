package expo.modules.storeinstaller

import expo.modules.storeinstaller.applink.SiblingPackages
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HealthTest {
  private val rows = listOf(mapOf<String, Any?>("app_id" to "deputy"))

  @Test fun refusesWithoutQueryingWhenTheProviderIsNotTrusted() {
    var queried = false
    assertNull(Health.read("deputy", { false }) { queried = true; rows })
    assertEquals(false, queried)
  }

  @Test fun readsWhenTrustedAndAsksAboutThePackageFromTheSiblingTable() {
    var asked: String? = null
    assertEquals(rows, Health.read("deputy", { asked = it; true }) { rows })
    assertEquals(SiblingPackages.DEPUTY, asked)
  }

  @Test fun everyReleaseIdMapsToItsSiblingPackage() {
    for ((id, pkg) in SiblingPackages.ALL) {
      var asked: String? = null
      Health.read(id, { asked = it; false }) { rows }
      assertEquals(id, pkg, asked)
    }
  }

  @Test fun anIdWithNoSiblingEntryIsNotReportedAndNeverAsksTrust() {
    var asked = false
    assertNull(Health.read("notch", { asked = true; true }) { rows })
    assertEquals(false, asked)
  }
}
