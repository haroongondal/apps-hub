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
  const val ACTION_RELEASE = "expo.modules.opentunnelnative.action.RELEASE_TUNNEL"
  const val EXTRA_CONFIG = "config"
  const val EXTRA_HOLD = "hold"
}
