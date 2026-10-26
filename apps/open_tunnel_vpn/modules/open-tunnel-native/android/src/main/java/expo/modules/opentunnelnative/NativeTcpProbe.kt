package expo.modules.opentunnelnative

import java.io.IOException
import java.net.BindException
import java.net.ConnectException
import java.net.InetSocketAddress
import java.net.NoRouteToHostException
import java.net.PortUnreachableException
import java.net.Socket
import java.net.SocketTimeoutException

/**
 * Single TCP connect measurement for relay health ranking (plan §4.2).
 *
 * Hard-classifier rule shared with the netlens engine (repo AGENTS #2): a
 * refused connect is a TCP RST emitted by a live host, so it is a valid
 * latency measurement and still returns the elapsed time. Only timeouts and
 * unroutable paths return null — the LatencyProber then keeps the upstream
 * static ping as the fitness input.
 *
 * The socket is destroyed immediately after the attempt (finally block).
 */
object NativeTcpProbe {

  /**
   * `ip:port` connect with the given timeout. Returns the measured RTT in
   * milliseconds for OPEN and REFUSED (RST) outcomes, null otherwise.
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
      when (error) {
        // TCP RST ⇒ live host: measured, like an open connect.
        is ConnectException -> elapsedMs(startedAt)
        // Timeout and unroutable families ⇒ offline for this attempt.
        is SocketTimeoutException -> null
        is NoRouteToHostException -> null
        is PortUnreachableException -> null
        is BindException -> null
        // UnknownHostException and any other IOException: no measurement.
        else -> null
      }
    } finally {
      runCatching { socket?.close() }
    }
  }

  private fun elapsedMs(startedAtNs: Long): Long =
    (System.nanoTime() - startedAtNs) / 1_000_000L
}
