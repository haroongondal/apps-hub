package expo.modules.haloengine.core

/** What the listener saw; never carries the notification's title or text. */
class PostedNote(
  val key: String,
  val pkg: String,
  val ongoing: Boolean,
  val importance: Int,
  val groupSummary: Boolean,
  val category: String?,
  val postedAtMs: Long,
  val onlyAlertOnce: Boolean = false,
)

/** colour is ARGB, or null to take it from the app icon. */
data class FlashDecision(val pkg: String, val colour: Int?, val style: String, val repeat: Int, val durationMs: Long)

/** Decides which posted notifications flash and which remind. Pure: the caller supplies the clock and the settings. */
class NotifyRules(private val ownPkg: String) {
  private class Tracked(val pkg: String, var lastMs: Long)

  // Insertion order = age, so the eldest is first. A burst on one key stays one entry.
  private val tracked = LinkedHashMap<String, Tracked>()

  // Last postTime per key, kept across unlocks: an ONLY_ALERT_ONCE update or a system re-post (auto-group keeps the postTime) is not a new alert.
  private val seen = LinkedHashMap<String, Long>()

  fun trackedCount(): Int = tracked.size

  /** Null when the note must stay silent. Silenced notes are not tracked, so they never remind later. */
  fun onPosted(n: PostedNote, s: SettingsNotify, minuteOfDay: Int, nowMs: Long): FlashDecision? {
    if (!eligible(n)) return null
    val prev = see(n)
    if (prev == n.postedAtMs || (prev != null && n.onlyAlertOnce)) return null
    val d = decide(n.pkg, s, minuteOfDay) ?: return null
    track(n.key, n.pkg, nowMs)
    return d
  }

  /** After a process restart: everything showing counts as seen, and what arrived since the last unlock reminds again, timed from its postTime. */
  fun restore(notes: List<PostedNote>, lastUnlockMs: Long, s: SettingsNotify, minuteAt: (Long) -> Int) {
    for (n in notes.filter(::eligible).sortedBy { it.postedAtMs }) {
      see(n)
      if (n.postedAtMs > lastUnlockMs && n.key !in tracked && decide(n.pkg, s, minuteAt(n.postedAtMs)) != null) track(n.key, n.pkg, n.postedAtMs)
    }
  }

  fun onRemoved(key: String) {
    tracked.remove(key)
    seen.remove(key)
  }

  /** The owner saw the phone, so nothing posted so far needs a reminder. */
  fun onUnlocked(nowMs: Long) = tracked.clear()

  /** Each key reminds at most once per period; a reminder due in quiet hours or for an app switched off is skipped, not queued. */
  fun dueReminders(s: SettingsNotify, minuteOfDay: Int, nowMs: Long): List<FlashDecision> {
    val period = periodMs(s) ?: return emptyList()
    val out = ArrayList<FlashDecision>()
    for (t in tracked.values) {
      if (nowMs - t.lastMs < period) continue
      t.lastMs = nowMs
      decide(t.pkg, s, minuteOfDay)?.let { out.add(it) }
    }
    return out
  }

  fun nextReminderAtMs(s: SettingsNotify): Long? {
    val period = periodMs(s) ?: return null
    return tracked.values.minOfOrNull { it.lastMs }?.plus(period)
  }

  private fun eligible(n: PostedNote) = n.pkg != ownPkg && !n.ongoing && n.importance >= IMPORTANCE_DEFAULT && !n.groupSummary

  private fun see(n: PostedNote): Long? {
    val prev = seen.remove(n.key)
    seen[n.key] = n.postedAtMs
    while (seen.size > MAX_TRACKED) seen.remove(seen.keys.first())
    return prev
  }

  private fun track(key: String, pkg: String, atMs: Long) {
    tracked.remove(key)
    tracked[key] = Tracked(pkg, atMs)
    while (tracked.size > MAX_TRACKED) tracked.remove(tracked.keys.first())
  }

  private fun periodMs(s: SettingsNotify): Long? = s.reminderMin?.let { it * 60_000L }

  private fun decide(pkg: String, s: SettingsNotify, minuteOfDay: Int): FlashDecision? {
    if (!s.enabled || QuietHours.active(s.quiet.on, s.quiet.start, s.quiet.end, minuteOfDay)) return null
    val app = s.apps[pkg]
    if (!(app?.on ?: s.defaultOn)) return null
    return FlashDecision(pkg, app?.colour?.let(::argb), s.style, s.repeat, s.durationMs.toLong())
  }

  private fun argb(hex: String): Int? = if (hex.length == 7 && hex[0] == '#') hex.substring(1).toIntOrNull(16)?.or(0xFF000000.toInt()) else null

  private companion object {
    const val IMPORTANCE_DEFAULT = 3
    const val MAX_TRACKED = 200
  }
}
