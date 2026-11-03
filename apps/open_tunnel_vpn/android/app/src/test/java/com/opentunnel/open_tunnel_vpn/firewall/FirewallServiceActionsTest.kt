package com.opentunnel.open_tunnel_vpn.firewall

import android.net.VpnService
import expo.modules.opentunnelnative.firewall.FirewallStartPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FirewallServiceActionsTest {

  @Test
  fun startsOnNoActionAndOnTheVpnServiceAction() {
    // Always-on may deliver either: AOSP behaviour is unverified until the Task 13 phone check logs it.
    assertTrue(FirewallService.startsOn(null))
    assertEquals("android.net.VpnService", VpnService.SERVICE_INTERFACE)
    assertTrue(FirewallService.startsOn(VpnService.SERVICE_INTERFACE))
  }

  @Test
  fun onlyNoActionAndTheVpnServiceActionAreImplicitStarts() {
    assertTrue(FirewallService.isImplicitStart(null))
    assertTrue(FirewallService.isImplicitStart(VpnService.SERVICE_INTERFACE))
    assertFalse(FirewallService.isImplicitStart(FirewallService.ACTION_START))
    assertFalse(FirewallService.isImplicitStart(FirewallService.ACTION_RESUME))
    assertFalse(FirewallService.isImplicitStart(FirewallService.ACTION_STOP))
  }

  @Test
  fun startsOnStartAndResume() {
    assertTrue(FirewallService.startsOn(FirewallService.ACTION_START))
    assertTrue(FirewallService.startsOn(FirewallService.ACTION_RESUME))
  }

  @Test
  fun everyStartActionMeetsTheServerCheck() {
    // Each of these runs start(), and start() refuses while server_active is "true": no action is exempt.
    for (action in listOf(null, VpnService.SERVICE_INTERFACE, FirewallService.ACTION_START, FirewallService.ACTION_RESUME)) {
      assertTrue("$action", FirewallService.startsOn(action))
    }
    assertTrue(FirewallStartPolicy.refusesStart("true"))
  }

  @Test
  fun doesNotStartOnTheOtherActions() {
    assertFalse(FirewallService.startsOn(FirewallService.ACTION_STOP))
    assertFalse(FirewallService.startsOn(FirewallService.ACTION_PAUSE))
    assertFalse(FirewallService.startsOn(FirewallService.ACTION_RELOAD))
    assertFalse(FirewallService.startsOn("com.example.UNKNOWN"))
  }
}
