package expo.modules.opentunnelnative.firewall

import org.junit.Assert.assertEquals
import org.junit.Test

class PrivateDnsTest {

  @Test
  fun hostnameIsStrictAndOffIsOff() {
    assertEquals("strict", PrivateDns.mode("hostname"))
    assertEquals("off", PrivateDns.mode("off"))
  }

  @Test
  fun opportunisticAndUnsetAreAutomatic() {
    assertEquals("automatic", PrivateDns.mode("opportunistic"))
    assertEquals("automatic", PrivateDns.mode(null))
  }
}
