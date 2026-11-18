package expo.modules.netlenscore

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Fire-and-forget datagram for Wake-on-LAN. Only private IPv4 destinations are allowed, so a bad or hostile
 * address can never make the app send traffic to the internet. The Swift twin (UdpBroadcast.swift) keeps the
 * same rules and the same error texts.
 */
object UdpBroadcast {
  private const val MAX_PAYLOAD = 1024

  /** Error text, or null when the datagram may be sent. [ip] must already be trimmed. */
  fun validate(ip: String, port: Int, payload: List<Int>): String? {
    val octets = parseIpv4(ip) ?: return "ip must be a dotted-quad IPv4 address"
    if (!isPrivate(octets)) return "ip must be a private IPv4 address"
    if (port !in 1..65535) return "port must be in 1..65535"
    if (payload.isEmpty() || payload.size > MAX_PAYLOAD) return "payload must be 1..$MAX_PAYLOAD bytes"
    if (payload.any { it !in 0..255 }) return "payload bytes must be in 0..255"
    return null
  }

  /** Four decimal octets, no signs, no leading zeros, no hex or short forms. Never touches DNS. */
  private fun parseIpv4(ip: String): IntArray? {
    val parts = ip.split('.')
    if (parts.size != 4) return null
    val octets = IntArray(4)
    for ((i, part) in parts.withIndex()) {
      if (part.isEmpty() || part.length > 3 || part.any { it !in '0'..'9' }) return null
      if (part.length > 1 && part[0] == '0') return null
      octets[i] = part.toInt()
      if (octets[i] > 255) return null
    }
    return octets
  }

  /** 10/8, 172.16/12, 192.168/16 and link-local 169.254/16 (same set as isPrivateIpv4 in packages/core). */
  private fun isPrivate(o: IntArray): Boolean =
    o[0] == 10 ||
      (o[0] == 172 && o[1] in 16..31) ||
      (o[0] == 192 && o[1] == 168) ||
      (o[0] == 169 && o[1] == 254)

  /**
   * Sends one datagram to a validated [ip]. [bind] pins the socket to Wi-Fi; it can fail under a VPN, then the
   * default route is used. A DatagramSocket send is all or nothing: it throws instead of sending short.
   */
  suspend fun send(ip: String, port: Int, payload: ByteArray, bind: (DatagramSocket) -> Unit = {}) =
    withContext(Dispatchers.IO) {
      DatagramSocket().use { socket ->
        socket.broadcast = true
        runCatching { bind(socket) }
        val target = InetAddress.getByAddress(parseIpv4(ip)!!.let { o -> ByteArray(4) { o[it].toByte() } })
        socket.send(DatagramPacket(payload, payload.size, target, port))
      }
    }
}
