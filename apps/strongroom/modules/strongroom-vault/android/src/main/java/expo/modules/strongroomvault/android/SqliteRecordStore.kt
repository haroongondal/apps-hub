package expo.modules.strongroomvault.android

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import expo.modules.strongroomvault.core.RecordStore

/** The vault on disk: the header and the sealed records exactly as the server will hold them. */
internal class SqliteRecordStore(context: Context) : SQLiteOpenHelper(context, "strongroom.db", null, 1), RecordStore {
  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE header(k TEXT PRIMARY KEY, v TEXT)")
    db.execSQL("CREATE TABLE records(id TEXT PRIMARY KEY, sealed BLOB NOT NULL)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

  override fun header(): String? =
    readableDatabase.rawQuery("SELECT v FROM header WHERE k = 'vault'", null).use { if (it.moveToFirst()) it.getString(0) else null }

  // execSQL throws on failure, where insert() would only return -1 and the write would look kept.
  override fun putHeader(json: String) = writableDatabase.execSQL("INSERT OR REPLACE INTO header(k, v) VALUES ('vault', ?)", arrayOf(json))

  override fun all(): Map<String, ByteArray> =
    readableDatabase.rawQuery("SELECT id, sealed FROM records", null).use { c ->
      buildMap { while (c.moveToNext()) put(c.getString(0), c.getBlob(1)) }
    }

  override fun putAll(records: Map<String, ByteArray>) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      for ((id, sealed) in records) db.execSQL("INSERT OR REPLACE INTO records(id, sealed) VALUES (?, ?)", arrayOf(id, sealed))
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }
}
