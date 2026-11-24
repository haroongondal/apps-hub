package expo.modules.inflowcore.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HubLaunchTest {
  @Test fun onlyTheStoreSignedLikeUsOpens() {
    assertTrue(HubLaunch.storeTrusted("com.haroon.store", true))
    assertFalse(HubLaunch.storeTrusted("com.haroon.store", false))
    assertFalse(HubLaunch.storeTrusted("com.haroon.store.fake", true))
    assertFalse(HubLaunch.storeTrusted("com.haroon.Store", true))
    assertFalse(HubLaunch.storeTrusted(null, true))
  }
}
