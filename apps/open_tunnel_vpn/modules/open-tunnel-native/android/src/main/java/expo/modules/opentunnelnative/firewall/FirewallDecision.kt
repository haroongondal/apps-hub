package expo.modules.opentunnelnative.firewall

enum class FirewallRule { ALLOW, BLOCK_ON_MOBILE, BLOCK_ALWAYS }

enum class Verdict { ALLOW, BLOCK }

/**
 * Pure rule decision. The caller resolves the UID and reads `onCellular` from the default
 * network's TRANSPORT_CELLULAR; a flow whose UID it cannot resolve is blocked and labelled
 * UNKNOWN_APP_LABEL.
 */
object FirewallDecision {

  const val UNKNOWN_APP_LABEL: String = "Unknown app"

  fun verdict(rule: FirewallRule, onCellular: Boolean): Verdict = when (rule) {
    FirewallRule.ALLOW -> Verdict.ALLOW
    FirewallRule.BLOCK_ON_MOBILE -> if (onCellular) Verdict.BLOCK else Verdict.ALLOW
    FirewallRule.BLOCK_ALWAYS -> Verdict.BLOCK
  }

  /** An unattributed flow could be a blocked app's, so it is blocked; Android names the owner of
   * every TCP and UDP socket an app or the system resolver opens, which leaves ICMP and sockets
   * already closed. */
  fun flowVerdict(uid: Int, rule: FirewallRule, onCellular: Boolean): Verdict =
    if (uid < 0) Verdict.BLOCK else verdict(rule, onCellular)

  /** The UID firestack passes to onQuery: the decimal UID from preflow, or -1 when there is none. */
  fun dnsUid(uid: String?): Int = uid?.toIntOrNull() ?: -1

  /** A blocked app gets no DNS answers either; an unattributed query is answered, or every app would lose DNS. */
  fun dnsVerdict(uid: Int, rule: FirewallRule, onCellular: Boolean): Verdict =
    if (uid < 0) Verdict.ALLOW else verdict(rule, onCellular)

  /** A connection that is already open must be closed when its rule now blocks it. */
  fun shouldCloseOpen(rule: FirewallRule, onCellular: Boolean): Boolean =
    verdict(rule, onCellular) == Verdict.BLOCK
}
