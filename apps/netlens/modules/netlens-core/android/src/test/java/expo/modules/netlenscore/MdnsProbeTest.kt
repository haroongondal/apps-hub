package expo.modules.netlenscore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The meta-query result to browsable-type mapping, the only pure part of the instance browse. */
class MdnsProbeTest {
  @Test
  fun `joins service name and protocol and drops the local suffix`() {
    assertEquals("_googlecast._tcp", MdnsProbe.browsableType("_googlecast", "_tcp.local."))
    assertEquals("_airplay._tcp", MdnsProbe.browsableType("_airplay", "_tcp.local"))
    assertEquals("_sleep-proxy._udp", MdnsProbe.browsableType("_sleep-proxy", "._udp.local."))
  }

  @Test
  fun `rejects results that are not a service type`() {
    assertNull(MdnsProbe.browsableType("My TV", "_tcp.local."))
    assertNull(MdnsProbe.browsableType("_http", "_sctp.local."))
    assertNull(MdnsProbe.browsableType(null, "_tcp.local."))
    assertNull(MdnsProbe.browsableType("_http", null))
  }
}
