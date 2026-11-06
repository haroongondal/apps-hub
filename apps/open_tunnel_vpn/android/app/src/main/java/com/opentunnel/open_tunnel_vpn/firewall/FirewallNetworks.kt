package com.opentunnel.open_tunnel_vpn.firewall

/**
 * The firewall tun's addresses and the ranges that stay out of it. The tun avoids firestack's default
 * 10.111.222.0/24 because that sits inside the 10.0.0.0/8 LAN exclusion.
 */
object FirewallNetworks {
  const val TUN_IPV4 = "100.127.222.1"
  const val TUN_IPV6 = "fd66:f83a:c650::1"
  const val TUN_IPV4_PREFIX = 24
  const val TUN_IPV6_PREFIX = 120
  const val TUN_DNS_IPV4 = "100.127.222.3"
  const val TUN_DNS_IPV6 = "fd66:f83a:c650::3"

  /** firestack wants host:port entries; a bare address leaves its DNS list empty. */
  const val FAKE_DNS = "$TUN_DNS_IPV4:53,[$TUN_DNS_IPV6]:53"

  const val MTU = 1500

  /** Private, link-local and multicast ranges: LAN traffic never enters the tun. */
  val LAN_EXCLUSIONS: List<Pair<String, Int>> = listOf(
    "10.0.0.0" to 8, "172.16.0.0" to 12, "192.168.0.0" to 16, "169.254.0.0" to 16,
    "224.0.0.0" to 4, "fe80::" to 10, "ff00::" to 8,
  )

  /** HomeNet scans the LAN with its own sockets, so it stays out of the tun. */
  const val HOMENET_PACKAGE = "app.netlens"
}
