package expo.modules.netlenscore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Gradle JVM acceptance test for the HARD OS RULE #2 (TCP RST = host alive):
 * a connection refused on loopback (no service listening) MUST be classified
 * REFUSED ⇒ reachable, with a measured RTT — never as offline.
 *
 * Uses only real java.net sockets: closed loopback ports are refused by the
 * local TCP stack (kernel RST) exactly like an RST responder on the LAN.
 */
class TcpProbeClassifierTest {

  @Test
  fun `connection refused on loopback classifies as REFUSED with measured RTT`() {
    val result = TcpProbe.connect("127.0.0.1", 9, 500) // discard port, closed on dev machines
    assertEquals(ProbeOutcome.REFUSED, result.outcome)
    assertEquals(9, result.port)
    assertNotNull(result.elapsedMs)
    assertTrue("RTT must be non-negative", (result.elapsedMs ?: -1L) >= 0L)
    assertTrue("REFUSED must count as reachable (hard rule #2)", TcpProbe.isReachable(result.outcome))
  }

  @Test
  fun `timeout verdict is offline`() {
    // TEST-NET-1 has no routable response in a sandboxed dev environment;
    // if the environment short-circuits to EHOSTUNREACH the assert shows it.
    val result = TcpProbe.connect("192.0.2.1", 80, 120)
    assertFalse(TcpProbe.isReachable(result.outcome))
    assertTrue(
      "offline verdicts are TIMEOUT or UNREACHABLE",
      result.outcome == ProbeOutcome.TIMEOUT || result.outcome == ProbeOutcome.UNREACHABLE,
    )
    assertNull(result.elapsedMs)
  }

  @Test
  fun `default port set matches the hard rule list`() {
    assertEquals(
      listOf(80, 443, 22, 445, 5353, 8080, 62078),
      TcpProbe.DEFAULT_PORTS,
    )
  }

  @Test
  fun `open verdict is reachable when a local listener exists`() {
    val server = java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))
    try {
      val port = server.localPort
      val result = TcpProbe.connect("127.0.0.1", port, 500)
      assertEquals(ProbeOutcome.OPEN, result.outcome)
      assertTrue(TcpProbe.isReachable(result.outcome))
      assertNotNull(result.elapsedMs)
    } finally {
      runCatching { server.close() }
    }
  }

  @Test
  fun `sweep opens every probe socket through the given factory`() = kotlinx.coroutines.runBlocking {
    val made = java.util.concurrent.atomic.AtomicInteger()
    TcpSweepEngine(listOf("127.0.0.1"), ports = listOf(9), timeoutMs = 500, newSocket = {
      made.incrementAndGet()
      java.net.Socket()
    }) {}.run()
    assertEquals("probes must use the Wi-Fi-bound factory, not the default route", 1, made.get())
  }
}
