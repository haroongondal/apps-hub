package expo.modules.inflowcore.android

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteException
import expo.modules.inflowcore.core.AppSetting
import expo.modules.inflowcore.core.Capture
import expo.modules.inflowcore.core.ItemStore
import expo.modules.inflowcore.core.KEY_LOST_MESSAGE
import expo.modules.inflowcore.core.OpenPlan
import expo.modules.inflowcore.core.SearchText
import expo.modules.inflowcore.core.openPlan
import net.zetetic.database.DatabaseErrorHandler
import net.zetetic.database.sqlcipher.SQLiteConnection
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SQLiteDatabaseHook
import net.zetetic.database.sqlcipher.SQLiteStatement

class SqlItemStore private constructor(private val db: SQLiteDatabase) : ItemStore {
  override fun appSetting(pkg: String): AppSetting? =
    query("SELECT pkg, label, record, keep_days FROM apps WHERE pkg = ?", pkg).use { if (it.moveToFirst()) it.toSetting() else null }

  override fun putAppSetting(s: AppSetting) {
    run(
      "INSERT INTO apps(pkg, label, record, keep_days) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(pkg) DO UPDATE SET label = excluded.label, record = excluded.record, keep_days = excluded.keep_days",
      s.pkg, s.label, if (s.record) 1L else 0L, s.keepDays?.toLong(),
    )
  }

  override fun insert(c: Capture, search: String, otpExpiresAt: Long?): Boolean {
    if (query("SELECT 1 FROM tombstones WHERE hash = ?", c.hash).use { it.moveToFirst() }) return false
    return run(
      "INSERT OR IGNORE INTO items(hash, pkg, app_label, sender, sender_key, conversation, conversation_key, title, text, " +
        "posted_at, captured_at, otp_expires_at, deleted_by_sender, search) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
      c.hash, c.pkg, c.appLabel, c.sender, c.senderKey, c.conversation, c.conversationKey, c.title, c.text,
      c.postedAt, System.currentTimeMillis(), otpExpiresAt, search,
    ) > 0
  }

  override fun markDeletedBySender(pkg: String, conversationKey: String?, sender: String?, postedAt: Long): Boolean =
    run(
      "UPDATE items SET deleted_by_sender = 1 WHERE pkg = ? AND conversation_key IS ? AND sender IS ? AND posted_at = ?",
      pkg, conversationKey, sender, postedAt,
    ) > 0

  override fun purgeExpiredOtps(now: Long): Int = transaction {
    run("INSERT OR IGNORE INTO tombstones(hash, at) SELECT hash, ? FROM items WHERE otp_expires_at IS NOT NULL AND otp_expires_at <= ?", now, now)
    run("DELETE FROM items WHERE otp_expires_at IS NOT NULL AND otp_expires_at <= ?", now)
  }

  override fun purgeOlder(pkg: String, cutoff: Long): Int = run("DELETE FROM items WHERE pkg = ? AND posted_at < ?", pkg, cutoff)

  override fun deleteApp(pkg: String): Int = run("DELETE FROM items WHERE pkg = ?", pkg)

  override fun allAppSettings(): List<AppSetting> =
    query("SELECT pkg, label, record, keep_days FROM apps ORDER BY label COLLATE NOCASE, pkg").use { c ->
      buildList { while (c.moveToNext()) add(c.toSetting()) }
    }

  override fun meta(key: String): String? =
    query("SELECT v FROM meta WHERE k = ?", key).use { if (it.moveToFirst()) it.getString(0) else null }

  override fun setMeta(key: String, value: String) {
    run("INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", key, value)
  }

  fun home(startOfDay: Long, now: Long): Map<String, Any> {
    val conversations = query(
      "SELECT i.conversation_key, i.pkg, i.app_label, COALESCE(n.name, i.conversation, i.conversation_key), i.text, i.posted_at, " +
        "(SELECT COUNT(*) FROM items t WHERE t.conversation_key = i.conversation_key AND t.posted_at >= ? AND $VISIBLE_T) " +
        "FROM items i LEFT JOIN sender_names n ON n.sender_key = i.conversation_key " +
        "WHERE i.conversation_key IS NOT NULL AND $VISIBLE_I " +
        "AND i.id = (SELECT j.id FROM items j WHERE j.conversation_key = i.conversation_key AND $VISIBLE_J " +
        "ORDER BY j.posted_at DESC, j.id DESC LIMIT 1) " +
        "ORDER BY i.posted_at DESC, i.id DESC LIMIT 5",
      startOfDay, now, now, now,
    ).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(
            mapOf(
              "key" to c.getString(0), "pkg" to c.getString(1), "appLabel" to c.getString(2), "name" to c.getString(3),
              "lastText" to c.getString(4), "lastAt" to c.getLong(5), "today" to c.getInt(6),
            ),
          )
        }
      }
    }
    val apps = query(
      "SELECT i.pkg, COALESCE(a.label, MAX(i.app_label)), MAX(i.posted_at), SUM(CASE WHEN i.posted_at >= ? THEN 1 ELSE 0 END) " +
        "FROM items i LEFT JOIN apps a ON a.pkg = i.pkg WHERE $VISIBLE_I " +
        "GROUP BY i.pkg ORDER BY MAX(i.posted_at) DESC LIMIT 8",
      startOfDay, now,
    ).use { c ->
      buildList {
        while (c.moveToNext()) add(mapOf("pkg" to c.getString(0), "label" to c.getString(1), "lastAt" to c.getLong(2), "today" to c.getInt(3)))
      }
    }
    return mapOf("conversations" to conversations, "apps" to apps)
  }

  fun list(filter: Map<String, Any?>, before: Long?, limit: Int, now: Long, beforeId: Long? = null): List<Map<String, Any?>> {
    val where = mutableListOf(VISIBLE_I)
    val args = mutableListOf<Any?>(now)
    when (filter["kind"] as? String) {
      "app" -> { where += "i.pkg = ?"; args += filter["pkg"] as? String }
      "conversation" -> { where += "i.conversation_key = ?"; args += filter["key"] as? String }
      "sender" -> { where += "COALESCE(n.name, i.sender) = ?"; args += filter["name"] as? String }
      "search" -> {
        // shortcut: LIKE scans every row; switch to FTS5 if search passes ~300 ms on the phone.
        for (term in SearchText.likeTerms(filter["query"] as? String ?: "")) {
          where += "i.search LIKE ? ESCAPE '\\'"
          args += term
        }
      }
    }
    if (before != null) {
      if (beforeId != null) {
        where += "(i.posted_at < ? OR (i.posted_at = ? AND i.id < ?))"
        args += before; args += before; args += beforeId
      } else {
        where += "i.posted_at < ?"; args += before
      }
    }
    args += limit.toLong()
    val sql = "SELECT i.id, i.pkg, i.app_label, i.sender, i.sender_key, COALESCE(n.name, i.sender), i.conversation, i.conversation_key, " +
      "i.title, i.text, i.posted_at, i.deleted_by_sender " +
      "FROM items i LEFT JOIN sender_names n ON n.sender_key = i.sender_key " +
      "WHERE ${where.joinToString(" AND ")} ORDER BY i.posted_at DESC, i.id DESC LIMIT ?"
    return query(sql, *args.toTypedArray()).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(
            mapOf(
              "id" to c.getLong(0), "pkg" to c.getString(1), "appLabel" to c.getString(2), "sender" to c.str(3), "senderKey" to c.str(4),
              "displayName" to c.str(5), "conversation" to c.str(6), "conversationKey" to c.str(7), "title" to c.str(8),
              "text" to c.getString(9), "postedAt" to c.getLong(10), "deletedBySender" to (c.getInt(11) != 0),
            ),
          )
        }
      }
    }
  }

  fun rename(senderKey: String, name: String?) {
    val clean = name?.trim().orEmpty()
    if (clean.isEmpty()) {
      run("DELETE FROM sender_names WHERE sender_key = ?", senderKey)
      return
    }
    run(
      "INSERT INTO sender_names(sender_key, sender, name) VALUES (?, " +
        "COALESCE((SELECT sender FROM items WHERE sender_key = ? AND sender IS NOT NULL ORDER BY posted_at DESC, id DESC LIMIT 1), ?), ?) " +
        "ON CONFLICT(sender_key) DO UPDATE SET sender = excluded.sender, name = excluded.name",
      senderKey, senderKey, senderKey, clean,
    )
  }

  fun senderNames(): List<Map<String, String>> =
    query("SELECT sender_key, sender, name FROM sender_names ORDER BY name COLLATE NOCASE, sender_key").use { c ->
      buildList { while (c.moveToNext()) add(mapOf("senderKey" to c.getString(0), "sender" to c.getString(1), "name" to c.getString(2))) }
    }

  private fun query(sql: String, vararg args: Any?): Cursor = db.rawQuery(sql, *args)

  private fun run(sql: String, vararg args: Any?): Int =
    db.compileStatement(sql).use { st ->
      args.forEachIndexed { i, a -> st.bindValue(i + 1, a) }
      st.executeUpdateDelete()
    }

  private fun <T> transaction(block: () -> T): T {
    db.beginTransaction()
    try {
      val result = block()
      db.setTransactionSuccessful()
      return result
    } finally {
      db.endTransaction()
    }
  }

  private fun SQLiteStatement.bindValue(i: Int, a: Any?) {
    when (a) {
      null -> bindNull(i)
      is Long -> bindLong(i, a)
      else -> bindString(i, a.toString())
    }
  }

  private fun Cursor.str(i: Int): String? = if (isNull(i)) null else getString(i)

  private fun Cursor.toSetting() = AppSetting(getString(0), getString(1), getInt(2) != 0, if (isNull(3)) null else getInt(3))

  companion object {
    private const val DB_NAME = "inflow.db"
    private const val SCHEMA_VERSION = 1
    private const val GENERIC_FAILURE =
      "Inflow can't open your saved history. The history file is kept, not deleted. Restart the phone and try again."
    private const val VISIBLE_I = "(i.otp_expires_at IS NULL OR i.otp_expires_at > ?)"
    private const val VISIBLE_J = "(j.otp_expires_at IS NULL OR j.otp_expires_at > ?)"
    private const val VISIBLE_T = "(t.otp_expires_at IS NULL OR t.otp_expires_at > ?)"
    private val lock = Any()

    private val SCHEMA = listOf(
      "CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, pkg TEXT NOT NULL, app_label TEXT NOT NULL, " +
        "sender TEXT, sender_key TEXT, conversation TEXT, conversation_key TEXT, title TEXT, text TEXT NOT NULL, " +
        "posted_at INTEGER NOT NULL, captured_at INTEGER NOT NULL, otp_expires_at INTEGER, " +
        "deleted_by_sender INTEGER NOT NULL DEFAULT 0, search TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS items_posted ON items(posted_at DESC)",
      "CREATE INDEX IF NOT EXISTS items_pkg ON items(pkg, posted_at DESC)",
      "CREATE INDEX IF NOT EXISTS items_conv ON items(conversation_key, posted_at DESC)",
      "CREATE INDEX IF NOT EXISTS items_otp ON items(otp_expires_at) WHERE otp_expires_at IS NOT NULL",
      "CREATE TABLE IF NOT EXISTS apps(pkg TEXT PRIMARY KEY, label TEXT NOT NULL, record INTEGER NOT NULL, keep_days INTEGER)",
      "CREATE TABLE IF NOT EXISTS sender_names(sender_key TEXT PRIMARY KEY, sender TEXT NOT NULL, name TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS tombstones(hash TEXT PRIMARY KEY, at INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)",
    )

    private val neverDeleteOnCorruption = object : DatabaseErrorHandler {
      override fun onCorruption(db: SQLiteDatabase, e: SQLiteException) {}
    }

    // Per connection: deleted rows (expired OTPs) are overwritten, not left in free pages.
    private val secureDelete = object : SQLiteDatabaseHook {
      override fun preKey(connection: SQLiteConnection) {}
      override fun postKey(connection: SQLiteConnection) {
        connection.executeForLong("PRAGMA secure_delete = ON", null, null)
      }
    }

    fun open(context: Context): Result<SqlItemStore> = synchronized(lock) {
      try {
        System.loadLibrary("sqlcipher")
        val file = context.getDatabasePath(DB_NAME)
        file.parentFile?.mkdirs()
        val plan = openPlan(file.exists(), DbKey.isWrappedKeyPresent(context))
        if (plan is OpenPlan.Fail) return Result.failure(IllegalStateException(plan.message))
        val key = DbKey.get(context, create = plan is OpenPlan.CreateNew)
          ?: return Result.failure(IllegalStateException(if (plan is OpenPlan.Open) KEY_LOST_MESSAGE else GENERIC_FAILURE))
        val raw = ("x'" + key.joinToString("") { "%02x".format(it) } + "'").toByteArray(Charsets.US_ASCII)
        key.fill(0)
        // raw is not zeroed: SQLCipher's connection config keeps this array and re-reads it if a connection is reopened.
        val db = SQLiteDatabase.openOrCreateDatabase(file, raw, null, neverDeleteOnCorruption, secureDelete).also { ensureSchema(it) }
        Result.success(SqlItemStore(db))
      } catch (e: SQLiteDatabaseCorruptException) {
        Result.failure(IllegalStateException(KEY_LOST_MESSAGE, e))
      } catch (e: Exception) {
        Result.failure(IllegalStateException(GENERIC_FAILURE, e))
      } catch (e: UnsatisfiedLinkError) {
        Result.failure(IllegalStateException(GENERIC_FAILURE, e))
      }
    }

    private fun ensureSchema(db: SQLiteDatabase) {
      try {
        if (db.version >= SCHEMA_VERSION) return
        db.beginTransaction()
        try {
          SCHEMA.forEach(db::execSQL)
          db.version = SCHEMA_VERSION
          db.setTransactionSuccessful()
        } finally {
          db.endTransaction()
        }
      } catch (e: Exception) {
        db.close()
        throw e
      }
    }
  }
}
