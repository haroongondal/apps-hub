package expo.modules.notchisland.core

/** One ongoing progress notification: its key, app, title and percent only, never its body text. A null percent is indeterminate. */
data class ProgressSnapshot(val key: String, val pkg: String, val title: String, val percent: Int?, val updatedAt: Long)

data class ProgressText(val title: String, val subtitle: String)

object Progress {
  private val SKIP_CATEGORIES = setOf("call", "alarm", "transport")
  private val PROGRESS_CATEGORIES = setOf("progress", "navigation")

  fun qualifies(ongoing: Boolean, category: String?, progressMax: Int, ownCard: Boolean): Boolean =
    ongoing && !ownCard && category !in SKIP_CATEGORIES && (progressMax > 0 || category in PROGRESS_CATEGORIES)

  fun percent(progress: Int, max: Int, indeterminate: Boolean): Int? =
    if (indeterminate || max <= 0) null else (progress.toLong() * 100 / max).toInt().coerceIn(0, 100)

  fun newest(all: Collection<ProgressSnapshot>): ProgressSnapshot? = all.maxByOrNull { it.updatedAt }

  // A call hides the card; media and timer rows stay above it, so it never displaces them.
  fun show(enabled: Boolean, progress: ProgressSnapshot?, rowsAbove: List<String>): Boolean =
    enabled && progress != null && "call" !in rowsAbove

  fun text(p: ProgressSnapshot, appLabel: String): ProgressText =
    ProgressText(
      p.title.replace(Regex("\\s+"), " ").trim(),
      listOfNotNull(appLabel.ifBlank { null }, p.percent?.let { "${it.coerceIn(0, 100)}%" }).joinToString("  ·  "),
    )
}
