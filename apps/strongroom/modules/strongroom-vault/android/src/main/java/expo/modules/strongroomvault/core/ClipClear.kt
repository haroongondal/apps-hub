package expo.modules.strongroomvault.core

/** pending: token of Strongroom's last copy no clear has handled. seen: token on the clip Android shows, "" if not ours, null if it shows none (API 29+ hides the clipboard from an unfocused app). */
object ClipClear {
  const val AFTER_MS = 30_000L

  enum class Step { NOTHING, FORGET, CLEAR, WAIT }

  fun due(pending: String?, seen: String?): Step = when {
    pending == null -> Step.NOTHING
    // Hidden in the background: wiping beats leaving a password behind, at the cost of anything else copied in those 30 s.
    seen == null || seen == pending -> Step.CLEAR
    else -> Step.FORGET
  }

  fun focused(pending: String?, seen: String?, copiedAt: Long, now: Long): Step = when {
    pending == null || seen == null -> Step.NOTHING
    seen != pending -> Step.FORGET
    now - copiedAt >= AFTER_MS -> Step.CLEAR
    else -> Step.WAIT
  }

  fun left(copiedAt: Long, now: Long): Long = (copiedAt + AFTER_MS - now).coerceIn(0, AFTER_MS)
}
