package expo.modules.haloengine.core

/** Packages that have posted a notification, newline-joined, most recent last, at most [CAP]. Package names only. */
object Notified {
  const val CAP = 500

  fun parse(stored: String): List<String> = stored.split('\n').filter { it.isNotEmpty() }

  /** The new stored string, or null when [pkg] is already the most recent (so a burst writes once). */
  fun add(stored: String, pkg: String, cap: Int = CAP): String? {
    val list = parse(stored)
    if (list.lastOrNull() == pkg) return null
    return (list.filter { it != pkg } + pkg).takeLast(cap).joinToString("\n")
  }
}
