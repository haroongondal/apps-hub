package expo.modules.opentunnelnative.firewall

/**
 * Pure rule for the starts nobody asked for in the UI: Always-on and the boot start deliver either no
 * action or the system's VpnService action. `enabled` is the `firewall_state` value the user's switch
 * writes, so a reboot with Always-on set and the firewall switched off starts nothing.
 */
object FirewallStartPolicy {

  fun startOnNullAction(enabled: String?): Boolean = enabled == "true"
}
