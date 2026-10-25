package expo.modules.netlenscore

import android.annotation.SuppressLint
import android.content.Context
import android.net.wifi.WifiManager
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** SSDP discovery payload (mirrors ServiceEvent, kind = "ssdp"). */
data class SsdpServicePayload(
  val location: String?,
  val server: String?,
  val usn: String?,
  val host: String?,
)

/**
 * Raw SSDP M-SEARCH over UDP multicast (239.255.255.250:1900), then parses
 * LOCATION / SERVER / USN from the unicast responses inside the window.
 *
 * HARD RULE (AGENTS.md #4): a WifiManager.MulticastLock is acquired before
 * discovery and released in the finally block.
 */
object SsdpProbe {
  private const val SSDP_ADDRESS = "239.255.255.250"
  private const val SSDP_PORT = 1900
  private const val RESPONSE_WINDOW_MS = 2500L
  private const val SOCKET_TIMEOUT_MS = 250

  val MSEARCH_PAYLOAD: String = listOf(
    "M-SEARCH * HTTP/1.1",
    "HOST: 239.255.255.250:1900",
    "MAN: \"ssdp:discover\"",
    "MX: 2",
    "ST: ssdp:all",
    "",
    "",
  ).joinToString("\r\n")

  @SuppressLint("WifiManagerLeak")
  suspend fun discover(
    context: Context?,
    windowMs: Long = RESPONSE_WINDOW_MS,
    onDiscovered: suspend (SsdpServicePayload) -> Unit,
  ): Int = withContext(Dispatchers.IO) {
    val multicastLock = acquireMulticastLock(context)
    var received = 0
    try {
      DatagramSocket().use { socket ->
        socket.soTimeout = SOCKET_TIMEOUT_MS
        val target = InetAddress.getByName(SSDP_ADDRESS)
        val bytes = MSEARCH_PAYLOAD.toByteArray(Charsets.ISO_8859_1)
        socket.send(DatagramPacket(bytes, bytes.size, target, SSDP_PORT))

        val deadline = System.currentTimeMillis() + windowMs
        val buffer = ByteArray(4096)
        val packet = DatagramPacket(buffer, buffer.size)
        while (System.currentTimeMillis() < deadline) {
          try {
            socket.receive(packet)
            val text = String(packet.data, packet.offset, packet.length, Charsets.UTF_8)
            val location = header(text, "LOCATION")
            val server = header(text, "SERVER")
            val usn = header(text, "USN")
            if (location != null || server != null || usn != null) {
              received += 1
              onDiscovered(
                SsdpServicePayload(
                  location = location,
                  server = server,
                  usn = usn,
                  host = packet.address.hostAddress,
                ),
              )
            }
          } catch (_: SocketTimeoutException) {
            // heartbeat between datagrams; loop until the window closes
          }
          ensureActive()
        }
      }
    } finally {
      multicastLock?.release()
    }
    received
  }

  internal fun header(raw: String, name: String): String? =
    raw.lineSequence()
      .firstOrNull { it.startsWith("$name:", ignoreCase = true) }
      ?.substringAfter(':')
      ?.trim()
      ?.takeIf { it.isNotEmpty() }

  @Suppress("DEPRECATION")
  private fun acquireMulticastLock(context: Context?): WifiManager.MulticastLock? {
    if (context == null) return null
    val wifiManager =
      context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    return wifiManager?.createMulticastLock("netlens-ssdp")?.apply {
      setReferenceCounted(false)
      acquire()
    }
  }
}
