package com.opentunnel.open_tunnel_vpn.firewall

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FirewallNetworksTest {

  @Test
  fun lanExclusionsAreExactlyThePrivateLinkLocalAndMulticastRanges() {
    assertEquals(
      listOf(
        "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16",
        "224.0.0.0/4", "fe80::/10", "ff00::/8",
      ),
      FirewallNetworks.LAN_EXCLUSIONS.map { (address, length) -> "$address/$length" },
    )
  }

  @Test
  fun homenetPackageIsNetlens() {
    assertEquals("app.netlens", FirewallNetworks.HOMENET_PACKAGE)
  }

  @Test
  fun fakeDnsIsHostPortForm() {
    assertEquals("100.127.222.3:53,[fd66:f83a:c650::3]:53", FirewallNetworks.FAKE_DNS)
    val entries = FirewallNetworks.FAKE_DNS.split(",")
    assertEquals(2, entries.size)
    for (entry in entries) {
      val split = entry.lastIndexOf(':')
      assertTrue("no port in $entry", split > 0)
      assertEquals(53, entry.substring(split + 1).toInt())
    }
    assertEquals("100.127.222.3", entries[0].substring(0, entries[0].lastIndexOf(':')))
    assertEquals("[fd66:f83a:c650::3]", entries[1].substring(0, entries[1].lastIndexOf(':')))
  }

  @Test
  fun tunAddressesAreTheDocumentedOnes() {
    assertEquals("100.127.222.1", FirewallNetworks.TUN_IPV4)
    assertEquals("fd66:f83a:c650::1", FirewallNetworks.TUN_IPV6)
  }
}
