package expo.modules.inflowcore.android

import android.database.Cursor
import expo.modules.inflowcore.core.Suggestion
import expo.modules.inflowcore.core.SuggestionRules
import expo.modules.inflowcore.core.SuggestionKind
import expo.modules.inflowcore.core.SuggestionState
import expo.modules.inflowcore.core.SuggestionStore
import expo.modules.inflowcore.core.movableFrom
import net.zetetic.database.sqlcipher.SQLiteDatabase

/** Shares the item store's database, so a suggestion and the AI result that made it can commit in one transaction. */
class SqlSuggestionStore(private val db: SQLiteDatabase) : SuggestionStore {
  // One statement, so the check and the insert cannot be split by another writer; executeInsert gives -1 when nothing was inserted.
  override fun add(s: Suggestion): Long? =
    db.compileStatement(ADD_SQL).use { st ->
      st.bindString(1, s.kind.name); st.bindString(2, s.title); st.bindLong(3, s.itemId)
      s.dueAt?.let { st.bindLong(4, it) } ?: st.bindNull(4)
      st.bindString(5, s.dedupeKey); st.bindString(6, s.state.name); st.bindLong(7, s.createdAt); st.bindLong(8, s.updatedAt); st.bindLong(9, s.expiresAt)
      st.bindString(10, s.dedupeKey)
      st.executeInsert().takeIf { it > 0 }
    }

  override fun waiting(): List<Suggestion> = list(setOf(SuggestionState.WAITING), Int.MAX_VALUE)

  override fun list(states: Set<SuggestionState>, limit: Int): List<Suggestion> {
    if (states.isEmpty()) return emptyList()
    val marks = states.joinToString(",") { "?" }
    return db.rawQuery("$SELECT WHERE state IN ($marks) ORDER BY created_at DESC, id DESC LIMIT ?", *(states.map { it.name } + limit.toLong()).toTypedArray())
      .use { c -> buildList { while (c.moveToNext()) add(c.toSuggestion()) } }
  }

  override fun get(id: Long): Suggestion? =
    db.rawQuery("$SELECT WHERE id = ?", id).use { if (it.moveToFirst()) it.toSuggestion() else null }

  override fun setState(id: Long, state: SuggestionState, now: Long): Boolean {
    val from = state.movableFrom()
    if (from.isEmpty()) return false
    val marks = from.joinToString(",") { "?" }
    return exec("UPDATE suggestions SET state = ?, updated_at = ? WHERE id = ? AND state IN ($marks)", state.name, now, id, *from.map { it.name }.toTypedArray()) > 0
  }

  override fun expire(now: Long): Int =
    exec("UPDATE suggestions SET state = 'EXPIRED', updated_at = ? WHERE state IN ('WAITING', 'STARTED') AND expires_at <= ?", now, now)

  override fun closeReplies(pkg: String, conversationKey: String, now: Long): Int =
    exec("UPDATE suggestions SET state = 'EXPIRED', updated_at = ? WHERE state = 'WAITING' AND kind = 'REPLY' AND dedupe_key = ?", now, SuggestionRules.replyKey(pkg, conversationKey))

  private fun exec(sql: String, vararg args: Any): Int =
    db.compileStatement(sql).use { st ->
      args.forEachIndexed { i, a -> if (a is Long) st.bindLong(i + 1, a) else st.bindString(i + 1, a.toString()) }
      st.executeUpdateDelete()
    }

  private fun Cursor.toSuggestion() = Suggestion(
    getLong(0), SuggestionKind.valueOf(getString(1)), getString(2), getLong(3), if (isNull(4)) null else getLong(4), getString(5),
    SuggestionState.valueOf(getString(6)), getLong(7), getLong(8), getLong(9),
  )

  internal companion object {
    const val SELECT = "SELECT id, kind, title, item_id, due_at, dedupe_key, state, created_at, updated_at, expires_at FROM suggestions"
    // A WAITING or STARTED row with the same key blocks the insert; so does a DONE or SKIPPED bill or event (one suggestion per biller and due date).
    const val ADD_SQL = "INSERT INTO suggestions(kind, title, item_id, due_at, dedupe_key, state, created_at, updated_at, expires_at) " +
      "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM suggestions WHERE dedupe_key = ? AND (state IN ('WAITING', 'STARTED') " +
      "OR (state IN ('DONE', 'SKIPPED') AND (dedupe_key LIKE 'bill:%' OR dedupe_key LIKE 'event:%'))))"
  }
}
