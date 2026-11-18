package expo.modules.inflowcore.core

class MemorySuggestionStore : SuggestionStore {
  val rows = LinkedHashMap<Long, Suggestion>()
  private var nextId = 1L

  // Mirrors SqlSuggestionStore.ADD_SQL: a DONE or SKIPPED bill or event also blocks its key.
  private fun open(key: String) = rows.values.any { it.dedupeKey == key && (it.state in OPEN || (it.state in FINISHED && (key.startsWith("bill:") || key.startsWith("event:")))) }

  override fun add(s: Suggestion): Long? {
    if (open(s.dedupeKey)) return null
    val id = nextId++
    rows[id] = s.copy(id = id)
    return id
  }

  override fun waiting() = list(setOf(SuggestionState.WAITING), Int.MAX_VALUE)

  override fun list(states: Set<SuggestionState>, limit: Int) =
    rows.values.filter { it.state in states }.sortedWith(compareByDescending<Suggestion> { it.createdAt }.thenByDescending { it.id }).take(limit)

  override fun get(id: Long) = rows[id]

  override fun setState(id: Long, state: SuggestionState, now: Long): Boolean {
    val s = rows[id] ?: return false
    if (s.state !in state.movableFrom()) return false
    rows[id] = s.copy(state = state, updatedAt = now)
    return true
  }

  override fun expire(now: Long): Int {
    val due = rows.values.filter { it.state in OPEN && it.expiresAt <= now }
    due.forEach { rows[it.id] = it.copy(state = SuggestionState.EXPIRED, updatedAt = now) }
    return due.size
  }

  override fun closeReplies(pkg: String, conversationKey: String, now: Long): Int {
    val hit = rows.values.filter { it.state == SuggestionState.WAITING && it.kind == SuggestionKind.REPLY && it.dedupeKey == SuggestionRules.replyKey(pkg, conversationKey) }
    hit.forEach { rows[it.id] = it.copy(state = SuggestionState.EXPIRED, updatedAt = now) }
    return hit.size
  }

  private companion object {
    val OPEN = setOf(SuggestionState.WAITING, SuggestionState.STARTED)
    val FINISHED = setOf(SuggestionState.DONE, SuggestionState.SKIPPED)
  }
}
