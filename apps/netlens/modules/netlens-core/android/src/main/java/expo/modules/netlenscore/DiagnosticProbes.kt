package expo.modules.netlenscore

import java.net.Inet4Address
import java.net.InetAddress
import java.net.UnknownHostException

/**
 * Phase 2 (FR-3) diagnostic probes — SPEC §5 / AGENTS.md #2.
 *
 * Built on the exact same socket classifier as the sweep engine
 * (TcpProbe.connect) so the hard rule stays single-sourced:
 * a TCP RST (`ConnectException`) is a VALID RTT carrier, never an offline
 * verdict. PingEngine consumes `Measurement.isRttCarrier` to decide whether
 * a sample measures latency or counts towards packet loss.
 */
object HandshakeProbe {

  /**
   * One TCP handshake measurement against (ip, port).
   * `OPEN` and `REFUSED` (RST carrier) are valid RTT measurements;
   * `TIMEOUT` / `UNREACHABLE` carry null and count as packet loss.
   */
  data class Measurement(
    val outcome: ProbeOutcome,
    val rttMs: Long?,
    val port: Int,
  ) {
    /** Gate used by PingEngine: open|refused with a measured RTT. */
    val isRttCarrier: Boolean
      get() = TcpProbe.isReachable(outcome) && rttMs != null
  }

  fun measure(ip: String, port: Int, timeoutMs: Int): Measurement {
    val probe = TcpProbe.connect(ip, port, timeoutMs)
    return Measurement(probe.outcome, probe.elapsedMs, probe.port)
  }
}

/**
 * Native resolver bridge: wall-time of an `InetAddress` lookup.
 * IPv4 candidates are preferred so both platforms emit the same payload
 * (iOS uses `getaddrinfo` with AF_INET); a failed lookup is still a valid
 * (failed) measurement — elapsed time is reported with success=false.
 */
object HostnameResolver {

  data class Measurement(
    val hostname: String,
    val addresses: List<String>,
    val durationMs: Long,
    val success: Boolean,
  )

  fun resolve(hostname: String): Measurement {
    val startedAt = System.nanoTime()
    val candidates: List<String> = try {
      val all = InetAddress.getAllByName(hostname)
      val ipv4 = all.filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress }.distinct()
      val allAddresses = all.mapNotNull { it.hostAddress }.distinct()
      if (ipv4.isEmpty()) allAddresses else ipv4
    } catch (error: UnknownHostException) {
      emptyList()
    }
    return Measurement(
      hostname = hostname,
      addresses = candidates,
      durationMs = elapsedMs(startedAt),
      success = candidates.isNotEmpty(),
    )
  }

  private fun elapsedMs(startedAtNs: Long): Long =
    (System.nanoTime() - startedAtNs) / 1_000_000L
}
