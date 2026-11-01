package expo.modules.opentunnelnative.firewall

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class LogEntry(
  val timestampMs: Long,
  val uid: Int,
  val pkg: String,
  val proto: String,
  val dst: String,
  val dstPort: Int,
  val domain: String?,
  val bytesOut: Long,
  val bytesIn: Long,
  val verdict: Verdict,
)

data class LogFilter(val uid: Int?, val blockedOnly: Boolean)

/**
 * Rules, the activity log and the firewall's state in one WAL database. The UI process and the
 * `:firewall` process each open their own FirewallStore on the same file; nothing is shared in memory.
 */
class FirewallStore(context: Context) {

  private val helper = object : SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {
    override fun onConfigure(db: SQLiteDatabase) {
      db.enableWriteAheadLogging()
    }

    override fun onCreate(db: SQLiteDatabase) {
      db.execSQL("CREATE TABLE rules(uid INTEGER PRIMARY KEY, pkg TEXT, rule TEXT)")
      db.execSQL(
        "CREATE TABLE log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, uid INTEGER, pkg TEXT, " +
          "proto TEXT, dst TEXT, dst_port INTEGER, domain TEXT, bytes_out INTEGER, bytes_in INTEGER, verdict TEXT)",
      )
      db.execSQL("CREATE TABLE firewall_state(key TEXT PRIMARY KEY, value TEXT)")
      db.execSQL("CREATE INDEX log_ts ON log(ts)")
      db.execSQL("CREATE INDEX log_uid ON log(uid)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
  }

  private val db: SQLiteDatabase get() = helper.writableDatabase

  fun setRule(uid: Int, pkg: String, rule: FirewallRule) {
    val values = ContentValues().apply {
      put("uid", uid)
      put("pkg", pkg)
      put("rule", rule.name)
    }
    db.insertWithOnConflict("rules", null, values, SQLiteDatabase.CONFLICT_REPLACE)
  }

  fun rules(): Map<Int, FirewallRule> =
    db.rawQuery("SELECT uid, rule FROM rules", null).use { c ->
      buildMap { while (c.moveToNext()) put(c.getInt(0), FirewallRule.valueOf(c.getString(1))) }
    }

  /** One transaction for the whole batch, never one write per entry. */
  fun appendBatch(entries: List<LogEntry>) {
    if (entries.isEmpty()) return
    val d = db
    d.beginTransaction()
    try {
      for (e in entries) {
        val values = ContentValues().apply {
          put("ts", e.timestampMs)
          put("uid", e.uid)
          put("pkg", e.pkg)
          put("proto", e.proto)
          put("dst", e.dst)
          put("dst_port", e.dstPort)
          put("domain", e.domain)
          put("bytes_out", e.bytesOut)
          put("bytes_in", e.bytesIn)
          put("verdict", e.verdict.name)
        }
        d.insertOrThrow("log", null, values)
      }
      d.setTransactionSuccessful()
    } finally {
      d.endTransaction()
    }
  }

  /** Newest first. */
  fun log(filter: LogFilter): List<LogEntry> {
    val where = ArrayList<String>()
    val args = ArrayList<String>()
    filter.uid?.let { where += "uid = ?"; args += it.toString() }
    if (filter.blockedOnly) { where += "verdict = ?"; args += Verdict.BLOCK.name }
    val clause = if (where.isEmpty()) "" else " WHERE " + where.joinToString(" AND ")
    val sql = "SELECT ts, uid, pkg, proto, dst, dst_port, domain, bytes_out, bytes_in, verdict " +
      "FROM log$clause ORDER BY ts DESC, id DESC"
    return db.rawQuery(sql, args.toTypedArray()).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(
            LogEntry(
              timestampMs = c.getLong(0),
              uid = c.getInt(1),
              pkg = c.getString(2),
              proto = c.getString(3),
              dst = c.getString(4),
              dstPort = c.getInt(5),
              domain = if (c.isNull(6)) null else c.getString(6),
              bytesOut = c.getLong(7),
              bytesIn = c.getLong(8),
              verdict = Verdict.valueOf(c.getString(9)),
            ),
          )
        }
      }
    }
  }

  fun clearLog() {
    db.delete("log", null, null)
  }

  fun writeState(key: String, value: String) {
    val values = ContentValues().apply {
      put("key", key)
      put("value", value)
    }
    db.insertWithOnConflict("firewall_state", null, values, SQLiteDatabase.CONFLICT_REPLACE)
  }

  fun readState(key: String): String? =
    db.rawQuery("SELECT value FROM firewall_state WHERE key = ?", arrayOf(key)).use { c ->
      if (c.moveToFirst()) c.getString(0) else null
    }

  fun enforceRetention(nowMs: Long) {
    val d = db
    val rows = d.rawQuery("SELECT id, ts FROM log ORDER BY ts, id", null).use { c ->
      buildList { while (c.moveToNext()) add(c.getLong(0) to c.getLong(1)) }
    }
    val ids = LogRetention.idsToDelete(rows, nowMs)
    if (ids.isEmpty()) return
    d.beginTransaction()
    try {
      val delete = d.compileStatement("DELETE FROM log WHERE id = ?")
      for (id in ids) {
        delete.bindLong(1, id)
        delete.executeUpdateDelete()
      }
      d.setTransactionSuccessful()
    } finally {
      d.endTransaction()
    }
  }

  private companion object {
    const val DB_NAME = "firewall.db"
    const val DB_VERSION = 1
  }
}
