package expo.modules.opentunnelnative

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServiceContractsTest {

  @Test
  fun aReleaseFromAReplacedEngineIsIgnored() {
    assertTrue(ServiceContracts.isStaleRelease(currentEngine = 2L, sender = 1L))
    assertTrue(ServiceContracts.isStaleRelease(currentEngine = 0L, sender = 1L))
  }

  @Test
  fun aReleaseFromTheCurrentEngineOrWithNoEngineRunningIsHandled() {
    assertFalse(ServiceContracts.isStaleRelease(currentEngine = 2L, sender = 2L))
    assertFalse(ServiceContracts.isStaleRelease(currentEngine = null, sender = 1L))
  }
}
