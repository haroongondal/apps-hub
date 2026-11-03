package expo.modules.opentunnelnative.firewall

enum class FirewallRule { ALLOW, BLOCK_ON_MOBILE, BLOCK_ALWAYS }

enum class Verdict { ALLOW, BLOCK }

/**
 * Pure rule decision. The caller resolves the UID and reads `onCellular` from the default
 * network's TRANSPORT_CELLULAR; a UID it cannot resolve gets Verdict.ALLOW and UNKNOWN_APP_LABEL.
 */
object FirewallDecision {

  const val UNKNOWN_APP_LABEL: String = "Unknown app"

  fun verdict(rule: FirewallRule, onCellular: Boolean): Verdict = when (rule) {
    FirewallRule.ALLOW -> Verdict.ALLOW
    FirewallRule.BLOCK_ON_MOBILE -> if (onCellular) Verdict.BLOCK else Verdict.ALLOW
    FirewallRule.BLOCK_ALWAYS -> Verdict.BLOCK
  }

  /** A connection that is already open must be closed when its rule now blocks it. */
  fun shouldCloseOpen(rule: FirewallRule, onCellular: Boolean): Boolean =
    verdict(rule, onCellular) == Verdict.BLOCK
}
