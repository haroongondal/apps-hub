package com.opentunnel.open_tunnel_vpn.firewall

import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UidResolverTest {

  @Test
  fun unknownUidGetsTheUnknownAppLabel() {
    assertEquals("Unknown app", UidResolver.packageLabel(-1, null))
    assertEquals("Unknown app", UidResolver.packageLabel(-1, arrayOf("com.example.app")))
  }

  @Test
  fun uidWithoutPackagesGetsUidLabel() {
    assertEquals("uid:10123", UidResolver.packageLabel(10123, null))
    assertEquals("uid:10123", UidResolver.packageLabel(10123, emptyArray()))
  }

  @Test
  fun sharedUidMapsToItsFirstPackage() {
    assertEquals("com.example.first", UidResolver.packageLabel(1000, arrayOf("com.example.first", "com.example.second")))
    assertEquals("com.example.only", UidResolver.packageLabel(10123, arrayOf("com.example.only")))
  }

  @Test
  fun socketAddressParsesIpv4AndBracketedIpv6() {
    val v4 = UidResolver.socketAddress("10.0.0.2:443")
    assertEquals(InetAddress.getByName("10.0.0.2"), v4?.address)
    assertEquals(443, v4?.port)
    val v6 = UidResolver.socketAddress("[fd00::1]:53")
    assertEquals(InetAddress.getByName("fd00::1"), v6?.address)
    assertEquals(53, v6?.port)
  }

  @Test
  fun socketAddressRejectsMissingOrMalformedPorts() {
    assertNull(UidResolver.socketAddress(null))
    assertNull(UidResolver.socketAddress("10.0.0.2"))
    assertNull(UidResolver.socketAddress("10.0.0.2:"))
    assertNull(UidResolver.socketAddress("10.0.0.2:https"))
  }
}
