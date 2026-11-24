package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OpenAppTest {
  @Test fun onlyTheStoreAndAiHubCanBeOpened() {
    assertEquals("com.haroon.store", OpenApp.packageFor("store"))
    assertEquals("com.haroon.aihub", OpenApp.packageFor("aihub"))
    listOf("", "Store", "deputy", "com.haroon.deputy", "com.android.settings", "store ").forEach { assertNull(it, OpenApp.packageFor(it)) }
  }

  @Test fun anAppIsOpenedOnlyWhenItIsThereAndSignedWithTheOwnersKey() {
    assertEquals("opened", OpenApp.outcome("com.haroon.store", launchable = true, signaturesMatch = true))
    assertEquals("not_installed", OpenApp.outcome("com.haroon.store", launchable = false, signaturesMatch = false))
    assertEquals("refused", OpenApp.outcome("com.haroon.store", launchable = true, signaturesMatch = false))
    assertEquals("refused", OpenApp.outcome(null, launchable = true, signaturesMatch = true))
  }
}
