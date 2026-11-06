package com.opentunnel.open_tunnel_vpn

import android.net.VpnService
import com.opentunnel.open_tunnel_vpn.firewall.FirewallService
import expo.modules.opentunnelnative.ServiceContracts
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SystemStartForwardTest {

  @Test
  fun forwardsTheSystemStartWhenTheFirewallIsOnAndNoServerRuns() {
    assertTrue(OpenTunnelVpnService.forwardsToFirewall(null, false, "true"))
    assertTrue(OpenTunnelVpnService.forwardsToFirewall(VpnService.SERVICE_INTERFACE, false, "true"))
  }

  @Test
  fun neverForwardsWhileAServerEngineRuns() {
    assertFalse(OpenTunnelVpnService.forwardsToFirewall(null, true, "true"))
    assertFalse(OpenTunnelVpnService.forwardsToFirewall(VpnService.SERVICE_INTERFACE, true, "true"))
  }

  @Test
  fun neverForwardsWhenTheFirewallSwitchIsOff() {
    assertFalse(OpenTunnelVpnService.forwardsToFirewall(null, false, "false"))
    assertFalse(OpenTunnelVpnService.forwardsToFirewall(VpnService.SERVICE_INTERFACE, false, "false"))
    // Nothing has written `enabled` yet: the user never turned the firewall on.
    assertFalse(OpenTunnelVpnService.forwardsToFirewall(VpnService.SERVICE_INTERFACE, false, null))
  }

  @Test
  fun neverForwardsAnActionTheAppSent() {
    assertFalse(OpenTunnelVpnService.forwardsToFirewall(ServiceContracts.ACTION_STOP, false, "true"))
    assertFalse(OpenTunnelVpnService.forwardsToFirewall(ServiceContracts.ACTION_RELEASE, false, "true"))
    assertFalse(OpenTunnelVpnService.forwardsToFirewall(FirewallService.ACTION_START, false, "true"))
    assertFalse(OpenTunnelVpnService.forwardsToFirewall("com.example.UNKNOWN", false, "true"))
  }
}
