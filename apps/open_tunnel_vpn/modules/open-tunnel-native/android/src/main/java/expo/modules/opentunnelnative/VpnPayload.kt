package expo.modules.opentunnelnative

/**
 * Payload-derived protocol sniffing — 1:1 with open-tunnel-core
 * `detectVpnProtocol` (packages/open-tunnel-core/src/vpngate.ts) so the JS
 * contract and the native router cannot disagree. AGENTS rule #1: routing
 * comes from the payload, never from the endpoint name.
 */
object VpnPayload {
  const val PROTOCOL_OPENVPN = "openvpn"
  const val PROTOCOL_WIREGUARD = "wireguard"

  private val protoLine = Regex(
    """^\s*proto\s+(?:tcp4?|tcp6|tcp|udp4?|udp6|udp)\b""",
    setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE),
  )

  fun detectProtocol(configText: String): String {
    val lower = configText.lowercase()
    if (lower.contains("[interface]") && lower.contains("privatekey")) {
      return PROTOCOL_WIREGUARD
    }
    val openVpnMarkers =
      lower.contains("<ca>") || protoLine.containsMatchIn(configText)
    return if (openVpnMarkers) PROTOCOL_OPENVPN else PROTOCOL_WIREGUARD
  }
}
