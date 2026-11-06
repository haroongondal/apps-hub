package expo.modules.netlenscore

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/**
 * Transports for name lookups (reverse DNS over UDP, NetBIOS, SSDP description over HTTP).
 * Both return null on any network failure; the TS resolver treats null as "no name".
 */
object NameProbes {
  // Short socket timeouts keep the read loops cancellable (blocking IO ignores coroutine cancellation).
  private const val SLICE_MS = 250L
  private const val UDP_BUFFER = 4096

  /** Sends [payload] to [ip]:[port] and returns the first reply from that same address, or null by [timeoutMs]. */
  suspend fun udpRequest(
    ip: String,
    port: Int,
    payload: ByteArray,
    timeoutMs: Int,
    bind: (DatagramSocket) -> Unit = {},
  ): ByteArray? = withContext(Dispatchers.IO) {
    try {
      DatagramSocket().use { socket ->
        // Binding to Wi-Fi can fail under a VPN (EPERM); send on the default route then.
        runCatching { bind(socket) }
        val target = InetAddress.getByName(ip)
        socket.send(DatagramPacket(payload, payload.size, target, port))

        val deadline = System.currentTimeMillis() + timeoutMs
        val packet = DatagramPacket(ByteArray(UDP_BUFFER), UDP_BUFFER)
        var reply: ByteArray? = null
        while (reply == null) {
          ensureActive()
          val remaining = deadline - System.currentTimeMillis()
          if (remaining <= 0) break
          socket.soTimeout = minOf(remaining, SLICE_MS).toInt()
          packet.length = UDP_BUFFER
          try {
            socket.receive(packet)
          } catch (_: SocketTimeoutException) {
            continue
          }
          // Anything else that reaches this ephemeral port (a stray broadcast, another host) is not the answer.
          if (packet.address == target && packet.port == port) {
            reply = packet.data.copyOfRange(packet.offset, packet.offset + packet.length)
          }
        }
        reply
      }
    } catch (_: IOException) {
      null
    }
  }

  /**
   * Connects, writes [request], reads until EOF, [maxBytes] or the [timeoutMs] deadline, and decodes UTF-8
   * (malformed bytes become U+FFFD). Null when the connect fails or nothing was read.
   */
  suspend fun tcpFetch(
    ip: String,
    port: Int,
    request: String,
    timeoutMs: Int,
    maxBytes: Int,
    socketFactory: () -> Socket = { Socket() },
  ): String? = withContext(Dispatchers.IO) {
    val deadline = System.currentTimeMillis() + timeoutMs
    val body = ByteArrayOutputStream()
    try {
      socketFactory().use { socket ->
        socket.connect(InetSocketAddress(InetAddress.getByName(ip), port), timeoutMs)
        socket.getOutputStream().apply {
          write(request.toByteArray(Charsets.UTF_8))
          flush()
        }
        val input = socket.getInputStream()
        val chunk = ByteArray(minOf(maxBytes, 4096))
        while (body.size() < maxBytes) {
          ensureActive()
          val remaining = deadline - System.currentTimeMillis()
          if (remaining <= 0) break
          socket.soTimeout = minOf(remaining, SLICE_MS).toInt()
          val n = try {
            input.read(chunk, 0, minOf(chunk.size, maxBytes - body.size()))
          } catch (_: SocketTimeoutException) {
            continue
          }
          if (n < 0) break
          body.write(chunk, 0, n)
        }
      }
    } catch (_: IOException) {
      // Keep what arrived: servers that answer and close with our request unread end the stream with a reset.
    }
    if (body.size() == 0) null else String(body.toByteArray(), Charsets.UTF_8)
  }
}
