package expo.modules.netlenscore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Gradle JVM acceptance tests for the Phase 2 handshake measurement
 * (FR-3 / SPEC §5). Enforces the diagnostic mirror of hard OS rule #2:
 * an OPEN connect and a REFUSED (TCP RST carrier) reply are BOTH valid RTT
 * measurements; only timeouts/unreachable count as packet loss. Uses real
 * java.net sockets against closed loopback ports (kernel RST), exactly
 * like TcpProbeClassifierTest.
 */
class DiagnosticProbesTest {

  @Test
  fun `refused handshake is a valid RTT carrier`() {
    val measurement = HandshakeProbe.measure("127.0.0.1", 9, 500) // discard port, closed
    assertEquals(ProbeOutcome.REFUSED, measurement.outcome)
    assertTrue("REFUSED must be an RTT carrier", measurement.isRttCarrier)
    assertNotNull("RST carrier must carry its measured RTT", measurement.rttMs)
    assertTrue("RTT must be non-negative", (measurement.rttMs ?: -1L) >= 0L)
  }

  @Test
  fun `open handshake is a valid RTT carrier`() {
    val server = java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))
    try {
      val measurement = HandshakeProbe.measure("127.0.0.1", server.localPort, 500)
      assertEquals(ProbeOutcome.OPEN, measurement.outcome)
      assertTrue(measurement.isRttCarrier)
      assertNotNull(measurement.rttMs)
      assertEquals(server.localPort, measurement.port)
    } finally {
      runCatching { server.close() }
    }
  }

  @Test
  fun `offline verdict channels packet loss instead of RTT`() {
    // TEST-NET-1: unroutable in sandboxed environments; either way the
    // handshake must NOT be an RTT carrier.
    val measurement = HandshakeProbe.measure("192.0.2.1", 80, 120)
    assertFalse(
      "offline verdicts must not count as measurements",
      measurement.isRttCarrier,
    )
    assertTrue(
      "expected TIMEOUT or UNREACHABLE",
      measurement.outcome == ProbeOutcome.TIMEOUT || measurement.outcome == ProbeOutcome.UNREACHABLE,
    )
    assertNull(measurement.rttMs)
  }

  @Test
  fun `resolver measures loopback name successfully`() {
    val measurement = HostnameResolver.resolve("localhost")
    assertTrue("localhost must resolve offline", measurement.success)
    assertTrue(measurement.addresses.contains("127.0.0.1"))
    assertTrue("wall time must be non-negative", measurement.durationMs >= 0L)
  }

  @Test
  fun `resolver failure still reports elapsed time`() {
    val measurement = HostnameResolver.resolve("nonexistent.invalid")
    if (!measurement.success) {
      assertTrue("a failed lookup is still a timed measurement", measurement.durationMs >= 0L)
      assertTrue(measurement.addresses.isEmpty())
    } else {
      // Non-conforming resolvers (captive portals, hijacker DNS) may resolve
      // .invalid to an address; that is counted as success — both paths valid.
      assertTrue(measurement.addresses.isNotEmpty())
    }
    assertEquals("nonexistent.invalid", measurement.hostname)
  }
}
