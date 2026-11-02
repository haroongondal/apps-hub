package expo.modules.opentunnelnative.firewall

import expo.modules.opentunnelnative.TunnelStatus

/**
 * What the Expo module, the app's `FirewallService` and the VPN controller share: how the service is
 * addressed (the module cannot import app classes, so by string), the `firewall_state` keys, and the pure
 * rules the module's firewall functions apply.
 */
object FirewallContract {

  const val SERVICE_CLASS_NAME = "com.opentunnel.open_tunnel_vpn.firewall.FirewallService"
  const val ACTION_START = "com.opentunnel.open_tunnel_vpn.firewall.START"
  const val ACTION_STOP = "com.opentunnel.open_tunnel_vpn.firewall.STOP"
  const val ACTION_PAUSE = "com.opentunnel.open_tunnel_vpn.firewall.PAUSE"
  const val ACTION_RESUME = "com.opentunnel.open_tunnel_vpn.firewall.RESUME"
  const val ACTION_RELOAD = "com.opentunnel.open_tunnel_vpn.firewall.RELOAD"

  const val STATE_RUNNING = "running"
  const val STATE_PAUSED = "paused"
  const val STATE_ENABLED = "enabled"
  const val STATE_LAST_START_ACTION = "last_start_action"

  /** Attribution (`getConnectionOwnerUid`) starts at Android 10. */
  const val MIN_SDK = 29
  const val MAX_LOG_LIMIT = 10_000

  fun isSupported(sdkInt: Int): Boolean = sdkInt >= MIN_SDK

  /** The wire string is the `FirewallRule` name; anything else is not a rule. */
  fun parseRule(wire: String?): FirewallRule? = FirewallRule.values().firstOrNull { it.name == wire }

  fun isLogLimitValid(limit: Int): Boolean = limit in 1..MAX_LOG_LIMIT

  /** A saved "true" counts only while the `:firewall` process is alive; a dead process leaves it stale. */
  fun isLive(state: String?, processAlive: () -> Boolean): Boolean = state == "true" && processAlive()

  /** A server connection owns the VPN slot; a firewall start would take it and drop the connection. */
  fun serverHoldsSlot(tunnelStatus: String): Boolean =
    tunnelStatus != TunnelStatus.DISCONNECTED && tunnelStatus != TunnelStatus.ERROR
}
