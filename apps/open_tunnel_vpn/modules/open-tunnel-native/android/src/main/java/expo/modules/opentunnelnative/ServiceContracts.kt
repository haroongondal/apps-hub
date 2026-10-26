package expo.modules.opentunnelnative

/**
 * Addressing for the app-package traffic service the module starts. The
 * module cannot import app classes (the Gradle dependency points the other
 * way), so the component is addressed by string; the action names and the
 * extras key live here as the single shared contract, imported by the
 * app-side service (one-way app → module dependency).
 */
object ServiceContracts {
  const val SERVICE_CLASS_NAME = "com.opentunnel.open_tunnel_vpn.OpenTunnelVpnService"
  const val ACTION_START = "expo.modules.opentunnelnative.action.START_TUNNEL"
  const val ACTION_STOP = "expo.modules.opentunnelnative.action.STOP_TUNNEL"
  const val EXTRA_CONFIG = "config"

  /**
   * Typed gate constant surfaced identically from the module (start-time
   * routing) and the service-side router (defense in depth). Gate G1
   * (ics-openvpn vendoring) also requires a project license decision the
   * owner has not made — see docs/phase2-session-log.md, §Gates.
   */
  const val OPENVPN_GATE_MESSAGE =
    "OpenVPN engine unavailable (gate G1 undecided): the ics-openvpn GPLv2 core needs a project license decision first — see docs/phase2-session-log.md"
}
