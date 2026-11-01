package expo.modules.netlenscore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

  /** Replays an arrival sequence the way the probe does: browse when shouldBrowse says so. */
  private fun browsedFor(arrivals: List<String?>): List<String> {
    val browsed = linkedSetOf<String>()
    for (type in arrivals) if (MdnsProbe.shouldBrowse(type, browsed)) browsed.add(type!!)
    return browsed.toList()
  }

  @Test
  fun `browses only the listed types that arrived, once each, in arrival order`() {
    val arrivals = listOf(
      "_http._tcp", "_hap._tcp", "_raop._tcp", "_googlecast._tcp", "_workstation._tcp", "_airplay._tcp",
      "_googlecast._tcp", "_spotify-connect._tcp", "_smb._tcp", "_device-info._tcp", "_ipp._tcp", "_companion-link._tcp",
      "_sleep-proxy._udp", null,
    )
    val browsed = browsedFor(arrivals)
    assertEquals(
      listOf("_hap._tcp", "_googlecast._tcp", "_airplay._tcp", "_smb._tcp", "_ipp._tcp", "_companion-link._tcp"),
      browsed,
    )
    assertTrue(browsed.size <= MdnsProbe.MAX_BROWSERS)
    assertTrue(MdnsProbe.BROWSE_TYPES.containsAll(browsed))
  }

  @Test
  fun `browses nothing when no listed type arrived`() {
    assertEquals(emptyList<String>(), browsedFor(listOf("_http._tcp", "_raop._tcp", "_workstation._tcp")))
  }

  @Test
  fun `never browses past the cap`() {
    val full = MdnsProbe.BROWSE_TYPES.take(MdnsProbe.MAX_BROWSERS).toSet()
    assertFalse(MdnsProbe.shouldBrowse("_googlecast._tcp", full - "_googlecast._tcp" + "_extra._tcp"))
  }
}
