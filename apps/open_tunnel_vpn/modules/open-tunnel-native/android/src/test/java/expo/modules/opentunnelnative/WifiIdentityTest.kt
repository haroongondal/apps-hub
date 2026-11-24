package expo.modules.opentunnelnative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WifiIdentityTest {

  @Test
  fun quotedSsidsAreUnquotedAndHexNamesKept() {
    assertEquals("Home", WifiIdentity.ssid("\"Home\""))
    assertEquals("a1b2c3", WifiIdentity.ssid("a1b2c3"))
  }

  @Test
  fun redactedOrEmptySsidsAreUnknown() {
    assertNull(WifiIdentity.ssid("<unknown ssid>"))
    assertNull(WifiIdentity.ssid("\"\""))
    assertNull(WifiIdentity.ssid(null))
  }

  @Test
  fun bssidsAreLowercasedAndTheRedactedOneIsUnknown() {
    assertEquals("aa:bb:cc:dd:ee:0f", WifiIdentity.bssid("AA:BB:CC:DD:EE:0F"))
    assertNull(WifiIdentity.bssid("02:00:00:00:00:00"))
    assertNull(WifiIdentity.bssid("not a mac"))
    assertNull(WifiIdentity.bssid(null))
  }
}
