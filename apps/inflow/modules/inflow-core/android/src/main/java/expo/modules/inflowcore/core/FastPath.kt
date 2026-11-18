package expo.modules.inflowcore.core

/** Autopilot's fast path: a picked chat or a person's SMS is sent to the AI soon after it stops arriving, not at the next 30-minute run. */
object FastPath {
  const val QUIET_MS = 45_000L
  const val MIN_GAP_MS = 60_000L

  private val NUMBER = Regex("""\+?\d{7,15}""")

  /**
   * How long until a fast run is due: null when nothing waits (no arrival, or the last fast run already took it), 0 when it is due now.
   * Due means 45 s quiet since the last fast arrival and at most one fast run a minute.
   */
  fun waitMs(lastArrivalAt: Long?, lastFastRunAt: Long?, now: Long): Long? {
    if (lastArrivalAt == null || (lastFastRunAt != null && lastArrivalAt <= lastFastRunAt)) return null
    val quiet = lastArrivalAt + QUIET_MS - now
    val gap = lastFastRunAt?.let { it + MIN_GAP_MS - now } ?: 0L
    return maxOf(0L, quiet, gap)
  }

  fun due(lastArrivalAt: Long?, lastFastRunAt: Long?, now: Long): Boolean = waitMs(lastArrivalAt, lastFastRunAt, now) == 0L

  // shortcut: a saved contact name from an SMS app counts as a person only through picked chats, upgrade if needed.
  fun isPerson(sender: String?): Boolean = sender != null && NUMBER.matches(sender.filter { it != ' ' && it != '-' && it != '(' && it != ')' })
}
