package expo.modules.opentunnelnative.firewall

/** Keep 7 days or 100,000 entries, whichever limit comes first. */
object LogRetention {

  const val MAX_AGE_MS: Long = 7 * 24 * 3600 * 1000L
  const val MAX_ROWS: Int = 100_000

  /** `rows` are (id, timestampMs), oldest first. Returns the ids to delete, oldest first. */
  fun idsToDelete(rows: List<Pair<Long, Long>>, nowMs: Long): List<Long> {
    val cutoff = nowMs - MAX_AGE_MS
    val (kept, expired) = rows.partition { it.second >= cutoff }
    val overflow = (kept.size - MAX_ROWS).coerceAtLeast(0)
    return (expired + kept.take(overflow)).map { it.first }
  }
}
