package expo.modules.clipboardcore.core

object Expiry {
  const val DEFAULT_DAYS = 30
  val CHOICES = listOf(7, 30, 90, 365)
  const val CODE_MS = 10 * 60_000L
  private const val DAY_MS = 86_400_000L

  /** The saved retention, or the default when nothing valid is saved. */
  fun days(saved: Int?): Int = saved?.takeIf { it in CHOICES } ?: DEFAULT_DAYS

  // One-time codes go after 10 minutes whatever the setting, pinned or not (a hidden row has no text to keep); a pinned password or text stays until deleted.
  fun expired(kind: String, at: Long, pinned: Boolean, now: Long, days: Int): Boolean {
    val age = now - at
    if (kind == ClipKind.CODE.id && age >= CODE_MS) return true
    if (pinned) return false
    return age >= days * DAY_MS
  }

  /**
   * The time an unpinned clip's age counts from. Unpinning stamps pinned_at, so an old clip is not deleted the moment it is
   * unpinned. A code always ages from when it was copied.
   */
  fun savedAt(kind: String, at: Long, pinnedAt: Long?): Long =
    if (kind == ClipKind.CODE.id) at else maxOf(at, pinnedAt ?: 0L)

  /**
   * The columns a pin change writes: the pin flag and its time, never `at`. `at` is the "newest clip" key that dedupe,
   * delete and the list order use, so moving it would make an old clip the newest.
   */
  fun pinColumns(pinned: Boolean, now: Long): Map<String, Long> = mapOf("pinned" to if (pinned) 1L else 0L, "pinned_at" to now)
}
