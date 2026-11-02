package expo.modules.opentunnelnative.firewall

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FirewallStartPolicyTest {

  @Test
  fun startsWhenTheUserSwitchIsOn() {
    assertTrue(FirewallStartPolicy.startOnNullAction("true"))
  }

  @Test
  fun doesNotStartWhenTheUserSwitchIsOff() {
    // Always-on with the firewall off, then a reboot: nothing starts.
    assertFalse(FirewallStartPolicy.startOnNullAction("false"))
  }

  @Test
  fun doesNotStartWhenThereIsNoState() {
    // Nothing has written `enabled` yet, so the user never turned the firewall on.
    assertFalse(FirewallStartPolicy.startOnNullAction(null))
  }
}
