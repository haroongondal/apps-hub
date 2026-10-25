package expo.modules.netlenscore

import java.net.BindException
import java.net.ConnectException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NoRouteToHostException
import java.net.PortUnreachableException
import java.net.Socket
import java.net.SocketTimeoutException
import java.io.IOException

/**
 * Outcomes of a single TCP probe. `REFUSED` is the hard-rule live signal:
 * a connect refused means the remote TCP stack actively emitted a TCP RST.
 */
enum class ProbeOutcome { OPEN, REFUSED, TIMEOUT, UNREACHABLE }

/** Result of oneTcp connect attempt against (ip, port). */
data class TcpProbeResult(val outcome: ProbeOutcome, val elapsedMs: Long?, val port: Int)

/**
 * Pure-JVM TCP probe + classifier (no Android dependencies so it can run as
 * a Gradle JVM unit test).
 *
 * HARD RULE (netlens/SPEC §3.2, AGENTS.md #2):
 *  - connect() success                    → OPEN (reachable, RTT measured)
 *  - ConnectException (ECONNREFUSED/RST)  → REFUSED (reachable, RTT measured)
 *  - SocketTimeoutException (ETIMEDOUT)   → TIMEOUT (offline)
 *  - NoRouteToHostException / PortUnreachableException / BindException-family
 *    (EHOSTUNREACH, ENETUNREACH…)         → UNREACHABLE (offline)
 */
object TcpProbe {

  /** Default hard-rule probe ports (netlens SPEC §3.2). */
  val DEFAULT_PORTS: List<Int> = listOf(80, 443, 22, 445, 5353, 8080, 62078)

  fun connect(ip: String, port: Int, timeoutMs: Int): TcpProbeResult {
    val startedAt = System.nanoTime()
    var socket: Socket? = null
    return try {
      socket = Socket()
      socket.connect(InetSocketAddress(ip, port), timeoutMs)
      TcpProbeResult(ProbeOutcome.OPEN, elapsedMs(startedAt), port)
    } catch (error: IOException) {
      when (error) {
        // TCP RST ⇒ host alive — this is the 2nd hard OS constraint.
        is ConnectException -> TcpProbeResult(ProbeOutcome.REFUSED, elapsedMs(startedAt), port)
        is SocketTimeoutException -> TcpProbeResult(ProbeOutcome.TIMEOUT, null, port)
        is NoRouteToHostException -> TcpProbeResult(ProbeOutcome.UNREACHABLE, null, port)
        is PortUnreachableException -> TcpProbeResult(ProbeOutcome.UNREACHABLE, null, port)
        is BindException -> TcpProbeResult(ProbeOutcome.UNREACHABLE, null, port)
        else -> TcpProbeResult(ProbeOutcome.UNREACHABLE, null, port)
      }
    } finally {
      runCatching { socket?.close() }
    }
  }

  fun isReachable(outcome: ProbeOutcome): Boolean =
    outcome == ProbeOutcome.OPEN || outcome == ProbeOutcome.REFUSED

  private fun elapsedMs(startedAtNs: Long): Long =
    (System.nanoTime() - startedAtNs) / 1_000_000L
}
