package expo.modules.netlenscore

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.LinkProperties
import android.net.NetworkCapabilities
import java.net.InetAddress
import java.net.Socket
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections

/** FR-1 native interface facts. */
data class NetLensInterface(val localIp: String, val cidrPrefix: Int, val gatewayIp: String?)

/**
 * FR-1: active-interface detection.
 *
 * Modern path (AGENTS.md #6): ConnectivityManager.getActiveNetwork() +
 * getLinkProperties(network) → IPv4 LinkAddress + default-route gateway.
 * NEVER deprecated WifiManager.getConnectionInfo().ipAddress.
 * NFR-3 resilience fallback: raw java.net.NetworkInterface when the active
 * network is unavailable (VPN tether cases, permission-restricted states),
 * with gateway reported as null.
 */
object PlatformNetwork {

  fun detect(context: Context?): NetLensInterface? {
    detectViaConnectivityManager(context)?.let { return it }
    return detectViaNetworkInterfaces()
  }

  private fun detectViaConnectivityManager(context: Context?): NetLensInterface? {
    if (context == null) return null
    val connectivityManager =
      context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        ?: return null
    val activeNetwork: Network = lanNetwork(connectivityManager) ?: return null
    val linkProperties: LinkProperties = connectivityManager.getLinkProperties(activeNetwork)
      ?: return null

    val ipv4Address = linkProperties.linkAddresses
      .firstOrNull { it.address is Inet4Address && !(it.address as Inet4Address).isLoopbackAddress }
      ?: return null

    val gateway = linkProperties.routes
      .firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }
      ?.gateway
      ?.hostAddress

    val localIp = (ipv4Address.address as Inet4Address).hostAddress ?: return null
    if (localIp.isBlank()) return null
    return NetLensInterface(localIp = localIp, cidrPrefix = ipv4Address.prefixLength, gatewayIp = gateway)
  }

  /**
   * The Wi-Fi/Ethernet network, even when a VPN is the default: probes routed into a VPN get answers for
   * addresses where no device exists (a phone behind a VPN reported 135 "hosts" on a 3-host /24).
   */
  @Suppress("DEPRECATION") // allNetworks: a one-shot lookup; a NetworkCallback would need lifecycle plumbing
  fun lanNetwork(cm: ConnectivityManager): Network? {
    fun isLan(n: Network) = cm.getNetworkCapabilities(n)?.let {
      !it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
        (it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || it.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
    } == true
    return cm.activeNetwork?.takeIf(::isLan) ?: cm.allNetworks.firstOrNull(::isLan) ?: cm.activeNetwork
  }

  /** Sockets for private (LAN) targets bound to [lanNetwork]; internet targets keep the default route. */
  fun socketFactoryFor(context: Context?, ip: String): () -> Socket {
    val cm = context?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    val lan = cm?.let(::lanNetwork)
    val addr = runCatching { InetAddress.getByName(ip) }.getOrNull()
    val isPrivate = addr != null && (addr.isSiteLocalAddress || addr.isLinkLocalAddress)
    // Inside a VPN that doesn't allow bypass, binding to Wi-Fi fails (EPERM); the system route then decides,
    // which keeps the LAN on Wi-Fi when the VPN excludes local routes (seen with OpenTunnel on HyperOS).
    return if (lan != null && isPrivate) ({ runCatching { lan.socketFactory.createSocket() }.getOrElse { Socket() } }) else ({ Socket() })
  }

  private fun detectViaNetworkInterfaces(): NetLensInterface? {
    return runCatching {
      Collections.list(NetworkInterface.getNetworkInterfaces()).asSequence()
        .filter { it.isUp && !it.isLoopback }
        .flatMap { it.interfaceAddresses.asSequence() }
        .firstOrNull { it.address is Inet4Address && it.networkPrefixLength.toInt() in 0..32 }
        ?.let { address ->
          val ip = (address.address as Inet4Address).hostAddress ?: return@let null
          if (ip.isBlank()) null
          else NetLensInterface(
            localIp = ip,
            cidrPrefix = address.networkPrefixLength.toInt(),
            gatewayIp = null, // gateway stays unknown on the fallback path
          )
        }
    }.getOrNull()
  }
}
