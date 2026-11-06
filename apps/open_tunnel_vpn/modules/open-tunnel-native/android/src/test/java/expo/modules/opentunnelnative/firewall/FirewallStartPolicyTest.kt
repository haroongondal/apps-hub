package expo.modules.opentunnelnative.firewall

import org.junit.Assert.assertEquals
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

  @Test
  fun refusesAStartWhileAServerHoldsTheSlot() {
    assertEquals("server_active", FirewallContract.STATE_SERVER_ACTIVE)
    assertTrue(FirewallStartPolicy.refusesStart("true"))
  }

  @Test
  fun allowsAStartWhenNoServerHoldsTheSlot() {
    assertFalse(FirewallStartPolicy.refusesStart("false"))
    // Nothing has written the flag yet: no server connection was ever made.
    assertFalse(FirewallStartPolicy.refusesStart(null))
  }
}
