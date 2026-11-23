package expo.modules.clipboardcore.core

object Expiry {
  const val DEFAULT_DAYS = 30
  val CHOICES = listOf(7, 30, 90, 365)
  const val CODE_MS = 10 * 60_000L
  private const val DAY_MS = 86_400_000L

  /** The saved retention, or the default when nothing valid is saved. */
  fun days(saved: Int?): Int = saved?.takeIf { it in CHOICES } ?: DEFAULT_DAYS

  // Pinned clips stay until deleted; one-time codes go after 10 minutes whatever the setting.
  fun expired(kind: String, at: Long, pinned: Boolean, now: Long, days: Int): Boolean {
    if (pinned) return false
    val age = now - at
    if (kind == ClipKind.CODE.id && age >= CODE_MS) return true
    return age >= days * DAY_MS
  }
}
