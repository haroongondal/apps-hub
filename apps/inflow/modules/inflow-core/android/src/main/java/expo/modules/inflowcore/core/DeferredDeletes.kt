package expo.modules.inflowcore.core

/**
 * File names to delete once the outermost database transaction has really committed. A transaction that did not commit (even an inner one
 * whose caller caught the error: the whole transaction then rolls back) releases nothing, so a live file is never deleted for a row that stays.
 */
class DeferredDeletes {
  private val names = mutableListOf<String>()
  private var rolledBack = false

  fun add(name: String) {
    names += name
  }

  /** Call as each transaction ends; returns the files to delete now (only at the outermost end, only when nothing rolled back). */
  fun ended(committed: Boolean, outermost: Boolean): List<String> {
    if (!committed) rolledBack = true
    if (!outermost) return emptyList()
    val release = if (rolledBack) emptyList() else names.toList()
    names.clear()
    rolledBack = false
    return release
  }
}
