package expo.modules.strongroomvault.android

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import expo.modules.strongroomvault.core.PullApplied
import expo.modules.strongroomvault.core.SyncMeta
import expo.modules.strongroomvault.core.SyncRecord
import expo.modules.strongroomvault.core.SyncRecordStore
import expo.modules.strongroomvault.core.SyncRow

internal object Schema {
  const val VERSION = 2

  val CREATE = listOf(
    "CREATE TABLE header(k TEXT PRIMARY KEY, v TEXT)",
    "CREATE TABLE records(id TEXT PRIMARY KEY, sealed BLOB NOT NULL, rev INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 0)",
    "CREATE TABLE meta(k TEXT PRIMARY KEY, v INTEGER NOT NULL)",
    "CREATE TABLE quarantine(id TEXT NOT NULL, rev INTEGER NOT NULL, sealed BLOB NOT NULL, PRIMARY KEY (id, rev))",
  )

  // Every record from before sync is dirty, so the first sync uploads the vault this phone already holds.
  fun upgrade(from: Int): List<String> =
    if (from >= 2) emptyList() else listOf(
      "ALTER TABLE records ADD COLUMN rev INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE records ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0",
      "UPDATE records SET dirty = 1",
    ) + CREATE.drop(2)
}

/** The vault on disk: the header and the sealed records exactly as the server will hold them, plus what sync needs. */
internal class SqliteRecordStore(context: Context) : SQLiteOpenHelper(context, "strongroom.db", null, Schema.VERSION), SyncRecordStore {
  override fun onCreate(db: SQLiteDatabase) = Schema.CREATE.forEach(db::execSQL)

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Schema.upgrade(oldVersion).forEach(db::execSQL)

  override fun header(): String? =
    readableDatabase.rawQuery("SELECT v FROM header WHERE k = 'vault'", null).use { if (it.moveToFirst()) it.getString(0) else null }

  // execSQL throws on failure, where insert() would only return -1 and the write would look kept.
  override fun putHeader(json: String) = writableDatabase.execSQL("INSERT OR REPLACE INTO header(k, v) VALUES ('vault', ?)", arrayOf(json))

  override fun all(): Map<String, ByteArray> =
    readableDatabase.rawQuery("SELECT id, sealed FROM records", null).use { c ->
      buildMap { while (c.moveToNext()) put(c.getString(0), c.getBlob(1)) }
    }

  override fun putAll(records: Map<String, ByteArray>) = transaction { db ->
    for ((id, sealed) in records) {
      db.execSQL(
        "INSERT INTO records(id, sealed, dirty) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET sealed = excluded.sealed, dirty = 1",
        arrayOf<Any>(id, sealed),
      )
    }
  }

  override fun syncRecords(): List<SyncRecord> =
    readableDatabase.rawQuery("SELECT id, sealed, rev, dirty FROM records", null).use { c ->
      buildList { while (c.moveToNext()) add(SyncRecord(c.getString(0), c.getBlob(1), c.getLong(2), c.getInt(3) != 0)) }
    }

  override fun syncMeta(): SyncMeta = meta(readableDatabase)

  override fun applyPull(p: PullApplied) = transaction { db ->
    p.header?.let { db.execSQL("INSERT OR REPLACE INTO header(k, v) VALUES ('vault', ?)", arrayOf(it.toJson())) }
    var held = false
    for (r in p.records) {
      val now = db.rawQuery("SELECT sealed FROM records WHERE id = ?", arrayOf(r.id)).use { if (it.moveToFirst()) it.getBlob(0) else null }
      if (if (r.seen == null) now != null else now == null || !now.contentEquals(r.seen)) {
        held = true
        continue
      }
      db.execSQL("INSERT OR REPLACE INTO records(id, sealed, rev, dirty) VALUES (?, ?, ?, 0)", arrayOf<Any>(r.id, r.sealed, r.rev))
    }
    val lastRev = if (held) meta(db).lastRev else p.lastRev
    db.execSQL("INSERT OR REPLACE INTO meta(k, v) VALUES ('headerRev', ?), ('lastRev', ?)", arrayOf(p.headerRev, lastRev))
    for (q in p.quarantine) db.execSQL("INSERT OR REPLACE INTO quarantine(id, rev, sealed) VALUES (?, ?, ?)", arrayOf<Any>(q.id, q.rev, q.sealed))
    for (b in p.rebase) db.execSQL("UPDATE records SET rev = ? WHERE id = ?", arrayOf<Any>(b.rev, b.id))
  }

  override fun markPushed(items: List<SyncRow>) = transaction { db ->
    for (i in items) {
      db.execSQL(
        "UPDATE records SET rev = ?, dirty = CASE WHEN sealed = ? THEN 0 ELSE dirty END WHERE id = ?",
        arrayOf<Any>(i.rev, i.sealed, i.id),
      )
    }
  }

  override fun quarantine(): List<Pair<String, Long>> =
    readableDatabase.rawQuery("SELECT id, rev FROM quarantine", null).use { c ->
      buildList { while (c.moveToNext()) add(c.getString(0) to c.getLong(1)) }
    }

  private fun meta(db: SQLiteDatabase): SyncMeta =
    db.rawQuery("SELECT k, v FROM meta", null).use { c ->
      val m = buildMap { while (c.moveToNext()) put(c.getString(0), c.getLong(1)) }
      SyncMeta(m["lastRev"] ?: 0, m["headerRev"] ?: 0)
    }

  private inline fun transaction(block: (SQLiteDatabase) -> Unit) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      block(db)
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }
}
