package expo.modules.opentunnelnative

import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Single TCP connect measurement for relay health ranking (plan §4.2).
 *
 * Unlike NetLens host discovery, a refused connect is not "alive" here: the
 * relay's VPN port is closed, so the relay is down. Every failure returns
 * null and the LatencyProber keeps the upstream static ping as fallback.
 *
 * The socket is destroyed immediately after the attempt (finally block).
 */
object NativeTcpProbe {

  /**
   * `ip:port` connect with the given timeout. Returns the measured RTT in
   * milliseconds when the connect completes, null otherwise.
   * Never throws for transport outcomes — resolution/network failures are
   * call-site concerns probed via the module's typed rejects.
   */
  fun connect(ip: String, port: Int, timeoutMs: Int): Long? {
    val startedAt = System.nanoTime()
    var socket: Socket? = null
    return try {
      socket = Socket()
      socket.connect(InetSocketAddress(ip, port), timeoutMs)
      elapsedMs(startedAt)
    } catch (error: IOException) {
      null
    } finally {
      runCatching { socket?.close() }
    }
  }

  private fun elapsedMs(startedAtNs: Long): Long =
    (System.nanoTime() - startedAtNs) / 1_000_000L
}
