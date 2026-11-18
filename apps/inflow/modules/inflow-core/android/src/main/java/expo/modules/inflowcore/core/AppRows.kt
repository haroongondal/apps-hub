package expo.modules.inflowcore.core

data class AppStat(val pkg: String, val label: String, val lastAt: Long, val today: Int, val hasChats: Boolean)

/** One row of the app lists: `pkgs` newest first (more than one only when same-label apps merged). */
data class AppRow(val label: String, val pkgs: List<String>, val lastAt: Long, val today: Int, val byContact: Boolean)

object AppRows {
  /** Contact apps stay one row each; other apps with the same label (trimmed, any case) merge. Newest first, ties by label then first package. */
  fun build(stats: List<AppStat>, sms: Set<String>): List<AppRow> {
    val rows = mutableListOf<AppRow>()
    val (contact, plain) = stats.partition { ContactApps.byContact(it.pkg, sms, it.hasChats) }
    contact.mapTo(rows) { AppRow(it.label, listOf(it.pkg), it.lastAt, it.today, true) }
    plain.groupBy { it.label.trim().lowercase() }.values.mapTo(rows) { g ->
      val byNew = g.sortedWith(compareByDescending<AppStat> { it.lastAt }.thenBy { it.pkg })
      AppRow(byNew.first().label, byNew.map { it.pkg }, byNew.first().lastAt, g.sumOf { it.today }, false)
    }
    return rows.sortedWith(compareByDescending<AppRow> { it.lastAt }.thenBy { it.label }.thenBy { it.pkgs.first() })
  }
}
