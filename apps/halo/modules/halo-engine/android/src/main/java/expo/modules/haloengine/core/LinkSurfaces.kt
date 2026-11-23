package expo.modules.haloengine.core

data class LinkSnapshot(
  val shield: ShieldRow? = null,
  val tunnelSeenAt: Long? = null,
  val newDevices: List<NewDeviceRow> = emptyList(),
  val home: List<HomeRow> = emptyList(),
  val suggestions: List<SuggestionRow> = emptyList(),
  val deputy: List<DeputyWaitingRow> = emptyList(),
  val briefing: List<BriefingLine> = emptyList(),
)

enum class WaitingFrom(val pkg: String) { INFLOW("com.haroon.inflow"), DEPUTY("com.haroon.deputy") }

data class WaitingItem(val title: String, val from: WaitingFrom, val dueAt: Long?)

data class AodLinks(val waitingCount: Int, val waitingTitles: List<String>, val briefing: List<String>) {
  val empty: Boolean get() = waitingCount == 0 && briefing.isEmpty()
}

object LinkSurfaces {
  const val SHIELD_FRESH_MS = 2 * 60 * 60_000L
  const val HOME_FRESH_MS = 2 * 60 * 60_000L
  const val NEW_DEVICE_MS = 24 * 60 * 60_000L
  const val SKEW_MS = 5 * 60_000L
  const val AOD_TITLES = 3
  const val AOD_BRIEFING = 4

  private fun fresh(at: Long?, now: Long, window: Long) = at != null && at <= now + SKEW_MS && now - at <= window

  // untrusted_now is only what TunnelWall last saw and goes stale when its process dies, so it counts only while its own time or TunnelWall's heartbeat is recent.
  fun shieldAlert(s: LinkSnapshot, now: Long): Boolean {
    val sh = s.shield ?: return false
    if (!sh.on) return false
    val untrusted = sh.untrustedNow && (fresh(sh.since, now, SHIELD_FRESH_MS) || fresh(s.tunnelSeenAt, now, SHIELD_FRESH_MS))
    return untrusted || s.newDevices.any { !it.acknowledged && fresh(it.firstSeenAt, now, NEW_DEVICE_MS) }
  }

  fun waiting(s: LinkSnapshot, now: Long): List<WaitingItem> {
    val inflow = s.suggestions
      .filter { it.state == "waiting" && it.expiresAt > now }
      .sortedWith(compareBy(nullsLast()) { it.dueAt })
      .map { WaitingItem(it.title, WaitingFrom.INFLOW, it.dueAt) }
    val deputy = s.deputy
      .filter { (it.state == "waiting_for_ok" && (it.dueAt == null || it.dueAt > now)) || it.state == "draft" }
      .map { WaitingItem(it.label, WaitingFrom.DEPUTY, it.dueAt) }
    return inflow + deputy
  }

  /** The always-on screen is the lock screen: titles that look like money or long numbers never show, private lines only with their switch. */
  fun aod(s: LinkSnapshot, links: SettingsLinks, now: Long): AodLinks {
    val items = if (links.waitingAod) waiting(s, now) else emptyList()
    val titles = items.mapNotNull { lockSafe(it.title) }.distinct().take(AOD_TITLES)
    val lines = if (!links.briefing) emptyList() else buildList {
      s.briefing.sortedBy { it.lineId }.filter { !it.personal || links.briefingPrivate }.mapNotNullTo(this) { lockSafe(it.text) }
      val home = s.home.count { it.present && fresh(it.lastSeenAt, now, HOME_FRESH_MS) }
      if (links.briefingPrivate && home > 0) add(if (home == 1) "1 person at home" else "$home people at home")
    }.distinct().take(AOD_BRIEFING)
    return AodLinks(items.size, titles, lines)
  }

  fun lockSafe(text: String): String? = text.takeUnless { AMOUNT.containsMatchIn(it) }

  fun bubbleTarget(items: List<WaitingItem>): String? =
    (items.firstOrNull { it.from == WaitingFrom.INFLOW } ?: items.firstOrNull())?.from?.pkg

  private val AMOUNT = Regex(
    "(?i)\\b(pkr|rs|inr|usd|aed|sar|eur|gbp)\\.?\\s?\\d|[$€£₹₨]\\s?\\d|\\d\\s?(pkr|rs|inr|usd|aed|sar|eur|gbp)\\b|\\d{1,3}([,.]\\d{3})+|\\d{5,}",
  )
}
