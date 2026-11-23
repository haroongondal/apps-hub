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

/** heads are Halo's own phrases; titles and lines are other apps' text and stay empty while the phone is locked. */
data class AodLinks(val waiting: String?, val waitingTitles: List<String>, val briefingHead: String?, val briefing: List<String>) {
  val empty: Boolean get() = waiting == null && briefingHead == null
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

  const val BRIEFING_HEAD = "Briefing"
  const val BRIEFING_READY = "Briefing ready"

  fun waitingPhrase(n: Int) = if (n == 1) "1 thing is waiting" else "$n things are waiting"

  // Fails closed: while locked only Halo's own phrases built from counts show, never a text column from another app.
  fun aod(s: LinkSnapshot, links: SettingsLinks, locked: Boolean, now: Long): AodLinks {
    val items = if (links.waitingAod) waiting(s, now) else emptyList()
    val waiting = items.size.takeIf { it > 0 }?.let(::waitingPhrase)
    val open = if (links.briefing) s.briefing.sortedBy { it.lineId }.filter { !it.personal } else emptyList()
    if (locked) return AodLinks(waiting, emptyList(), if (open.isEmpty()) null else BRIEFING_READY, emptyList())
    val lines = if (!links.briefing) emptyList() else buildList {
      s.briefing.sortedBy { it.lineId }.filter { !it.personal || links.briefingPrivate }.mapTo(this) { it.text }
      val home = s.home.count { it.present && fresh(it.lastSeenAt, now, HOME_FRESH_MS) }
      if (links.briefingPrivate && home > 0) add(if (home == 1) "1 person at home" else "$home people at home")
    }.distinct().take(AOD_BRIEFING)
    val titles = items.map { it.title }.distinct().take(AOD_TITLES)
    return AodLinks(waiting, titles, if (lines.isEmpty()) null else BRIEFING_HEAD, lines)
  }

  fun bubbleTarget(items: List<WaitingItem>): String? =
    (items.firstOrNull { it.from == WaitingFrom.INFLOW } ?: items.firstOrNull())?.from?.pkg
}
