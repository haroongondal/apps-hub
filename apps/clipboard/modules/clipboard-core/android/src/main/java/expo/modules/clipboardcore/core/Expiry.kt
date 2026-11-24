package expo.modules.clipboardcore.core

object Expiry {
  const val DEFAULT_DAYS = 30
  val CHOICES = listOf(7, 30, 90, 365)
  const val CODE_MS = 10 * 60_000L
  private const val DAY_MS = 86_400_000L

  /** The saved retention, or the default when nothing valid is saved. */
  fun days(saved: Int?): Int = saved?.takeIf { it in CHOICES } ?: DEFAULT_DAYS

  // One-time codes go after 10 minutes whatever the setting, pinned or not (a hidden row has no text to keep); other pinned clips stay until deleted.
  fun expired(kind: String, at: Long, pinned: Boolean, now: Long, days: Int): Boolean {
    val age = now - at
    if (kind == ClipKind.CODE.id && age >= CODE_MS) return true
    if (pinned) return false
    return age >= days * DAY_MS
  }

  /** The saved time an unpinned clip starts from: now, so an old clip is not deleted the moment it is unpinned. Pinning keeps it (null). */
  fun savedAtOnPinChange(pinned: Boolean, now: Long): Long? = if (pinned) null else now
}
