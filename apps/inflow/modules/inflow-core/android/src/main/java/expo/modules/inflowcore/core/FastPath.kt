package expo.modules.inflowcore.core

/** Autopilot's fast path: a picked chat or a person's SMS is sent to the AI soon after it stops arriving, not at the next 30-minute run. */
object FastPath {
  const val QUIET_MS = 45_000L
  const val MIN_GAP_MS = 60_000L

  private val NUMBER = Regex("""\+?\d{7,15}""")

  /** Quiet for 45 s since the last fast arrival, at most one fast run a minute, and nothing new since the last fast run means nothing to send. */
  fun due(lastArrivalAt: Long?, lastFastRunAt: Long?, now: Long): Boolean {
    if (lastArrivalAt == null || now - lastArrivalAt < QUIET_MS) return false
    return lastFastRunAt == null || (now - lastFastRunAt >= MIN_GAP_MS && lastArrivalAt > lastFastRunAt)
  }

  // shortcut: a saved contact name from an SMS app counts as a person only through picked chats, upgrade if needed.
  fun isPerson(sender: String?): Boolean = sender != null && NUMBER.matches(sender)
}
