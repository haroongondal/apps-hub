package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.JournalEntry
import expo.modules.inflowcore.core.JournalStore

/** The journal table (schema v10). Tags are joined with commas: no fixed tag contains one. */
class SqlJournalStore(private val store: SqlItemStore) : JournalStore {
  override fun page(beforeAt: Long, limit: Int): List<JournalEntry> =
    store.query(PAGE, beforeAt, limit.toLong()).use { c ->
      buildList {
        while (c.moveToNext()) add(JournalEntry(c.getLong(0), c.getLong(1), c.getInt(2), c.getString(3).split(',').filter(String::isNotEmpty), c.getString(4)))
      }
    }

  override fun insert(e: JournalEntry, now: Long): Long =
    store.db.compileStatement(INSERT).use { st ->
      st.bindLong(1, e.at); st.bindLong(2, e.mood.toLong()); st.bindString(3, e.tags.joinToString(",")); st.bindString(4, e.note); st.bindLong(5, now)
      st.executeInsert()
    }

  override fun update(e: JournalEntry): Boolean = store.run(UPDATE, e.at, e.mood.toLong(), e.tags.joinToString(","), e.note, e.id) > 0

  override fun delete(id: Long) {
    store.run(DELETE, id)
  }

  companion object {
    internal const val PAGE = "SELECT id, at, mood, tags, note FROM journal WHERE at < ? ORDER BY at DESC, id DESC LIMIT ?"
    internal const val INSERT = "INSERT INTO journal(at, mood, tags, note, created_at) VALUES (?, ?, ?, ?, ?)"
    internal const val UPDATE = "UPDATE journal SET at = ?, mood = ?, tags = ?, note = ? WHERE id = ?"
    internal const val DELETE = "DELETE FROM journal WHERE id = ?"
  }
}
