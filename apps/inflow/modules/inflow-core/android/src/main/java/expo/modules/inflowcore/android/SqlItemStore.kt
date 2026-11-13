package expo.modules.inflowcore.android

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteException
import expo.modules.inflowcore.core.AiInput
import expo.modules.inflowcore.core.AiMeta
import expo.modules.inflowcore.core.AiResult
import expo.modules.inflowcore.core.AiStore
import expo.modules.inflowcore.core.AppSetting
import expo.modules.inflowcore.core.AskItem
import expo.modules.inflowcore.core.Channel
import expo.modules.inflowcore.core.Capture
import expo.modules.inflowcore.core.Email
import expo.modules.inflowcore.core.ItemStore
import expo.modules.inflowcore.core.KEY_LOST_MESSAGE
import expo.modules.inflowcore.core.OpenPlan
import expo.modules.inflowcore.core.SearchText
import expo.modules.inflowcore.core.Sms
import expo.modules.inflowcore.core.openPlan
import net.zetetic.database.DatabaseErrorHandler
import net.zetetic.database.sqlcipher.SQLiteConnection
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SQLiteDatabaseHook
import net.zetetic.database.sqlcipher.SQLiteStatement

class SqlItemStore private constructor(internal val db: SQLiteDatabase) : ItemStore, AiStore {
  override fun appSetting(pkg: String): AppSetting? =
    query("SELECT pkg, label, record, keep_days FROM apps WHERE pkg = ?", pkg).use { if (it.moveToFirst()) it.toSetting() else null }

  override fun putAppSetting(s: AppSetting) {
    run(
      "INSERT INTO apps(pkg, label, record, keep_days) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(pkg) DO UPDATE SET label = excluded.label, record = excluded.record, keep_days = excluded.keep_days",
      s.pkg, s.label, if (s.record) 1L else 0L, s.keepDays?.toLong(),
    )
  }

  override fun insert(c: Capture, search: String, otpExpiresAt: Long?, smsHash: String?, emailHash: String?): Long? {
    if (isTombstoned(c.hash)) return null
    if (smsHash != null && hasSmsHash(smsHash)) return null
    if (emailHash != null && hasEmailHash(emailHash)) return null
    val added = run(
      "INSERT OR IGNORE INTO items(hash, pkg, app_label, sender, sender_key, conversation, conversation_key, title, text, " +
        "posted_at, captured_at, otp_expires_at, deleted_by_sender, search, sms_hash, email_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
      c.hash, c.pkg, c.appLabel, c.sender, c.senderKey, c.conversation, c.conversationKey, c.title, c.text,
      c.postedAt, System.currentTimeMillis(), otpExpiresAt, search, smsHash, emailHash,
    )
    if (added == 0) return null
    return query("SELECT id FROM items WHERE hash = ?", c.hash).use { if (it.moveToFirst()) it.getLong(0) else null }
  }

  override fun isTombstoned(hash: String): Boolean = query("SELECT 1 FROM tombstones WHERE hash = ?", hash).use { it.moveToFirst() }

  override fun hasSmsHash(smsHash: String): Boolean = query("SELECT 1 FROM items WHERE sms_hash = ?", smsHash).use { it.moveToFirst() }

  override fun hasEmailHash(emailHash: String): Boolean = query("SELECT 1 FROM items WHERE email_hash = ?", emailHash).use { it.moveToFirst() }

  override fun emailTwin(subject: String, at: Long, windowMs: Long): Long? {
    if (subject.isBlank()) return null
    return query(
      "SELECT id FROM items WHERE pkg = ? AND email_hash IS NULL AND posted_at BETWEEN ? AND ? AND substr(text, 1, length(?)) = ? " +
        "ORDER BY abs(posted_at - ?), id DESC LIMIT 1",
      Email.GMAIL, at - windowMs, at + windowMs, subject, subject, at,
    ).use { if (it.moveToFirst()) it.getLong(0) else null }
  }

  override fun emailItemNear(text: String, at: Long, windowMs: Long): Boolean =
    query(
      "SELECT 1 FROM items WHERE pkg = ? AND email_hash IS NOT NULL AND email_text IS NULL AND posted_at BETWEEN ? AND ? AND title <> '' AND substr(?, 1, length(title)) = title LIMIT 1",
      Email.GMAIL, at - windowMs, at + windowMs, text,
    ).use { it.moveToFirst() }

  override fun claimEmail(itemId: Long, emailHash: String, emailText: String, search: String) {
    run("UPDATE items SET email_hash = ?, email_text = ?, search = search || ' ' || ? WHERE id = ?", emailHash, emailText, search, itemId)
  }

  override fun smsItemNear(text: String, at: Long, windowMs: Long): Boolean =
    query("SELECT 1 FROM items WHERE sms_hash IS NOT NULL AND posted_at BETWEEN ? AND ? AND text = ? LIMIT 1", at - windowMs, at + windowMs, text)
      .use { it.moveToFirst() }

  override fun notificationTwin(text: String, at: Long, windowMs: Long, pkgs: Set<String>): Long? {
    if (pkgs.isEmpty()) return null
    val marks = pkgs.joinToString(",") { "?" }
    return query(
      "SELECT id FROM items WHERE sms_hash IS NULL AND posted_at BETWEEN ? AND ? AND text = ? AND pkg IN ($marks) " +
        "ORDER BY posted_at DESC, id DESC LIMIT 1",
      at - windowMs, at + windowMs, text, *pkgs.toTypedArray(),
    ).use { if (it.moveToFirst()) it.getLong(0) else null }
  }

  override fun setSmsHash(itemId: Long, smsHash: String) {
    run("UPDATE OR IGNORE items SET sms_hash = ? WHERE id = ?", smsHash, itemId)
  }

  override fun enqueueAi(itemId: Long, at: Long) {
    run("INSERT OR IGNORE INTO ai_queue(item_id, at) VALUES (?, ?)", itemId, at)
  }

  override fun enabledSince(): Long? = meta(AiMeta.SINCE)?.toLongOrNull()

  // The send-time filter (also behind queuedCount): the item still exists, is no OTP, was posted after the first key, its app records, and neither app nor sender is blocked.
  // A row that fails it is deleted first, so an item blocked or left out at send time can never go out later (unblocking does not bring it back).
  override fun queued(limit: Int): List<AiInput> {
    val since = enabledSince() ?: return emptyList()
    run("DELETE FROM ai_queue WHERE item_id NOT IN (SELECT i.id FROM items i WHERE i.posted_at >= ? AND $NEVER_SEND_FILTER)", since)
    return query(
      "SELECT i.id, i.app_label, COALESCE(n.name, i.sender), i.title, COALESCE(i.email_text, i.text), i.posted_at $QUEUE_FROM ORDER BY q.at, q.item_id LIMIT ?",
      since, limit.toLong(),
    ).use { c -> buildList { while (c.moveToNext()) add(AiInput(c.getLong(0), c.getString(1), c.str(2), c.str(3), c.getString(4), c.getLong(5))) } }
  }

  fun queuedCount(): Int {
    val since = enabledSince() ?: return 0
    return query("SELECT COUNT(*) $QUEUE_FROM", since).use { if (it.moveToFirst()) it.getInt(0) else 0 }
  }

  override fun save(results: List<AiResult>, now: Long) = transaction {
    for (r in results) {
      // The item may have been deleted while the request ran: its result would be an orphan.
      if (query("SELECT 1 FROM items WHERE id = ?", r.itemId).use { !it.moveToFirst() }) continue
      run(
        "INSERT OR REPLACE INTO ai_results(item_id, kind, summary, importance, tags, at) VALUES (?, ?, ?, ?, ?, ?)",
        r.itemId, r.kind.name.lowercase(), r.summary, r.importance.name.lowercase(), r.tags.joinToString(","), now,
      )
      run("DELETE FROM todos WHERE item_id = ?", r.itemId)
      r.todos.forEach { run("INSERT INTO todos(item_id, text, due_at) VALUES (?, ?, ?)", r.itemId, it.text, it.dueAt) }
    }
    results.forEach { run("DELETE FROM ai_queue WHERE item_id = ?", it.itemId) }
  }

  override fun failed(itemIds: List<Long>) = transaction {
    itemIds.forEach { run("UPDATE ai_queue SET tries = tries + 1 WHERE item_id = ?", it) }
    run("DELETE FROM ai_queue WHERE tries >= 2")
    Unit
  }

  override fun spentToday(day: String): Double =
    query("SELECT usd FROM ai_spend WHERE day = ?", day).use { if (it.moveToFirst()) it.getDouble(0) else 0.0 }

  override fun addSpend(day: String, usd: Double) {
    run("INSERT INTO ai_spend(day, usd) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET usd = usd + excluded.usd", day, usd.toString())
  }

  /** The channel this item's money came in on, as Ingest chose it when the item was saved. */
  fun channelOf(itemId: Long, smsPackages: Set<String>): Channel =
    query("SELECT pkg, sms_hash IS NOT NULL, email_hash IS NOT NULL, email_text IS NOT NULL FROM items WHERE id = ?", itemId).use { c ->
      if (!c.moveToFirst()) return@use Channel.NOTIFICATION
      val pkg = c.getString(0)
      when {
        pkg == Email.GMAIL -> if (c.getInt(2) != 0 || c.getInt(3) != 0) Channel.EMAIL else Channel.EMAIL_NOTIFICATION
        pkg in smsPackages -> if (c.getInt(1) != 0) Channel.SMS else Channel.SMS_NOTIFICATION
        else -> Channel.NOTIFICATION
      }
    }

  /** Ask AI: the newest `limit` items in the range that pass the never-send filter and were posted after the first key. `pkgs` empty = every app. */
  fun askItems(from: Long, to: Long, pkgs: List<String>, since: Long, limit: Int): List<AskItem> {
    val where = StringBuilder("i.posted_at BETWEEN ? AND ? AND i.posted_at >= ? AND $NEVER_SEND_FILTER")
    val args = mutableListOf<Any?>(from, to, since)
    if (pkgs.isNotEmpty()) {
      where.append(" AND i.pkg IN (${pkgs.joinToString(",") { "?" }})")
      args.addAll(pkgs)
    }
    args += limit.toLong()
    return query(
      "SELECT i.app_label, COALESCE(n.name, i.sender), i.posted_at, r.summary, COALESCE(i.email_text, i.text) " +
        "FROM items i LEFT JOIN sender_names n ON n.sender_key = i.sender_key LEFT JOIN ai_results r ON r.item_id = i.id " +
        "WHERE $where ORDER BY i.posted_at DESC, i.id DESC LIMIT ?",
      *args.toTypedArray(),
    ).use { c -> buildList { while (c.moveToNext()) add(AskItem(c.getString(0), c.str(1), c.getLong(2), c.str(3), c.getString(4))) } }
  }

  fun setTodoDone(id: Long, done: Boolean) {
    run("UPDATE todos SET done = ? WHERE id = ?", if (done) 1L else 0L, id)
  }

  override fun markDeletedBySender(pkg: String, conversationKey: String?, sender: String?, postedAt: Long): Boolean =
    run(
      "UPDATE items SET deleted_by_sender = 1 WHERE pkg = ? AND conversation_key IS ? AND sender IS ? AND posted_at = ?",
      pkg, conversationKey, sender, postedAt,
    ) > 0

  override fun purgeExpiredOtps(now: Long): Int = transaction {
    val expired = query("SELECT hash, text FROM items WHERE otp_expires_at IS NOT NULL AND otp_expires_at <= ?", now).use { c ->
      buildList { while (c.moveToNext()) add(c.getString(0) to c.getString(1)) }
    }
    for ((hash, text) in expired) {
      run("INSERT OR IGNORE INTO tombstones(hash, at) VALUES (?, ?)", hash, now)
      run("INSERT OR IGNORE INTO tombstones(hash, at) VALUES (?, ?)", Sms.textHash(text), now)
    }
    run("DELETE FROM items WHERE otp_expires_at IS NOT NULL AND otp_expires_at <= ?", now)
  }

  override fun purgeOlder(pkg: String, cutoff: Long): Int = transaction {
    forgetAi("pkg = ? AND posted_at < ?", pkg, cutoff)
    tombstoneEmails("pkg = ? AND posted_at < ?", pkg, cutoff)
    run("DELETE FROM items WHERE pkg = ? AND posted_at < ?", pkg, cutoff)
  }

  override fun deleteApp(pkg: String): Int = transaction {
    forgetAi("pkg = ?", pkg)
    tombstoneEmails("pkg = ?", pkg)
    run("DELETE FROM items WHERE pkg = ?", pkg)
  }

  // The AI result, queue entry and to-dos go with their item.
  private fun forgetAi(where: String, vararg args: Any?) {
    for (table in listOf("ai_results", "ai_queue", "todos")) run("DELETE FROM $table WHERE item_id IN (SELECT id FROM items WHERE $where)", *args)
  }

  // Deleted emails would otherwise come back when a reconnect resets the cursors.
  private fun tombstoneEmails(where: String, vararg args: Any?) {
    run("INSERT OR IGNORE INTO tombstones(hash, at) SELECT email_hash, ? FROM items WHERE email_hash IS NOT NULL AND $where", System.currentTimeMillis(), *args)
  }

  override fun allAppSettings(): List<AppSetting> =
    query("SELECT pkg, label, record, keep_days FROM apps ORDER BY label COLLATE NOCASE, pkg").use { c ->
      buildList { while (c.moveToNext()) add(c.toSetting()) }
    }

  override fun meta(key: String): String? =
    query("SELECT v FROM meta WHERE k = ?", key).use { if (it.moveToFirst()) it.getString(0) else null }

  override fun setMeta(key: String, value: String) {
    run("INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", key, value)
  }

  fun deleteMeta(key: String) {
    run("DELETE FROM meta WHERE k = ?", key)
  }

  fun gmailSenders(): List<GmailSender> =
    query("SELECT query, uid_validity, last_uid FROM gmail_senders ORDER BY query").use { c ->
      buildList { while (c.moveToNext()) add(GmailSender(c.getString(0), if (c.isNull(1)) null else c.getLong(1), c.getLong(2))) }
    }

  fun addGmailSender(query: String) {
    run("INSERT OR IGNORE INTO gmail_senders(query) VALUES (?)", query)
  }

  /** Emails already saved stay. */
  fun removeGmailSender(query: String) {
    run("DELETE FROM gmail_senders WHERE query = ?", query)
  }

  fun setGmailCursor(query: String, uidValidity: Long, lastUid: Long) {
    run("UPDATE gmail_senders SET uid_validity = ?, last_uid = ? WHERE query = ?", uidValidity, lastUid, query)
  }

  /** A different mailbox starts over; saved emails dedupe by message id, so re-reading is harmless. */
  fun resetGmailCursors() {
    run("UPDATE gmail_senders SET uid_validity = NULL, last_uid = 0")
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
    val important = query(
      "SELECT $ITEM_COLUMNS $ITEM_FROM WHERE r.importance = 'high' AND i.posted_at >= ? AND $VISIBLE_I ORDER BY i.posted_at DESC, i.id DESC LIMIT 5",
      now - 7 * DAY_MS, now,
    ).use { c -> buildList { while (c.moveToNext()) add(c.toItem()) } }
    // Not done, due from the start of today (soonest first) or undated and from the last 3 days (after the dated ones).
    val comingUp = query(
      "SELECT t.id, t.item_id, t.text, t.due_at, t.done FROM todos t JOIN items i ON i.id = t.item_id " +
        "WHERE t.done = 0 AND $VISIBLE_I AND ((t.due_at IS NOT NULL AND t.due_at >= ?) OR (t.due_at IS NULL AND i.posted_at >= ?)) " +
        "ORDER BY t.due_at IS NULL, t.due_at, t.id LIMIT 5",
      now, startOfDay, now - 3 * DAY_MS,
    ).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(mapOf("id" to c.getLong(0), "itemId" to c.getLong(1), "text" to c.getString(2), "dueAt" to if (c.isNull(3)) null else c.getLong(3), "done" to (c.getInt(4) != 0)))
        }
      }
    }
    return mapOf("conversations" to conversations, "apps" to apps, "important" to important, "comingUp" to comingUp)
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
    val sql = "SELECT $ITEM_COLUMNS $ITEM_FROM WHERE ${where.joinToString(" AND ")} ORDER BY i.posted_at DESC, i.id DESC LIMIT ?"
    return query(sql, *args.toTypedArray()).use { c -> buildList { while (c.moveToNext()) add(c.toItem()) } }
  }

  /** Null when retention removed the item or it is an OTP past its 5 minutes. */
  fun item(id: Long, now: Long): Map<String, Any?>? =
    query("SELECT $ITEM_COLUMNS $ITEM_FROM WHERE i.id = ? AND $VISIBLE_I", id, now).use { if (it.moveToFirst()) it.toItem() else null }

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

  internal fun query(sql: String, vararg args: Any?): Cursor = db.rawQuery(sql, *args)

  internal fun run(sql: String, vararg args: Any?): Int =
    db.compileStatement(sql).use { st ->
      args.forEachIndexed { i, a -> st.bindValue(i + 1, a) }
      st.executeUpdateDelete()
    }

  /** One write lock for the whole block; nested use joins the outer transaction. */
  fun <T> inTransaction(block: () -> T): T = transaction(block)

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

  private fun Cursor.toItem(): Map<String, Any?> = mapOf(
    "id" to getLong(0), "pkg" to getString(1), "appLabel" to getString(2), "sender" to str(3), "senderKey" to str(4),
    "displayName" to str(5), "conversation" to str(6), "conversationKey" to str(7), "title" to str(8),
    "text" to getString(9), "postedAt" to getLong(10), "deletedBySender" to (getInt(11) != 0), "emailText" to str(12),
    "ai" to str(13)?.let { mapOf("kind" to it, "summary" to getString(14), "importance" to getString(15), "tags" to (str(16)?.split(',')?.filter(String::isNotEmpty) ?: emptyList())) },
  )

  private fun Cursor.str(i: Int): String? = if (isNull(i)) null else getString(i)

  private fun Cursor.toSetting() = AppSetting(getString(0), getString(1), getInt(2) != 0, if (isNull(3)) null else getInt(3))

  companion object {
    private const val DB_NAME = "inflow.db"
    private const val SCHEMA_VERSION = 4
    private const val GENERIC_FAILURE =
      "Inflow can't open your saved history. The history file is kept, not deleted. Restart the phone and try again."
    private const val ITEM_COLUMNS = "i.id, i.pkg, i.app_label, i.sender, i.sender_key, COALESCE(n.name, i.sender), i.conversation, " +
      "i.conversation_key, i.title, i.text, i.posted_at, i.deleted_by_sender, i.email_text, r.kind, r.summary, r.importance, r.tags"
    private const val ITEM_FROM = "FROM items i LEFT JOIN sender_names n ON n.sender_key = i.sender_key LEFT JOIN ai_results r ON r.item_id = i.id"
    // What may be sent to the AI (R29 and the global constraint): the app records, and neither the app nor the sender is blocked.
    internal const val SENDABLE = "COALESCE((SELECT a.record FROM apps a WHERE a.pkg = i.pkg), 1) = 1 " +
      "AND NOT EXISTS (SELECT 1 FROM ai_blocks b WHERE b.block_key = 'app:' || i.pkg) " +
      "AND (i.sender_key IS NULL OR NOT EXISTS (SELECT 1 FROM ai_blocks b WHERE b.block_key = 'sender:' || i.sender_key))"
    internal const val NEVER_SEND_FILTER = "i.otp_expires_at IS NULL AND $SENDABLE"
    private const val QUEUE_FROM = "FROM ai_queue q JOIN items i ON i.id = q.item_id LEFT JOIN sender_names n ON n.sender_key = i.sender_key " +
      "WHERE i.posted_at >= ? AND $NEVER_SEND_FILTER"
    private const val DAY_MS = 86_400_000L
    private const val VISIBLE_I = "(i.otp_expires_at IS NULL OR i.otp_expires_at > ?)"
    private const val VISIBLE_J = "(j.otp_expires_at IS NULL OR j.otp_expires_at > ?)"
    private const val VISIBLE_T = "(t.otp_expires_at IS NULL OR t.otp_expires_at > ?)"
    private val lock = Any()

    private val SCHEMA_V1 = listOf(
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

    // Not idempotent: ensureSchema runs it once, in the same transaction as the version bump.
    // items is rebuilt with AUTOINCREMENT (ids kept) because txn_sources.item_id has no foreign key: a deleted item's id must never come back.
    private val SCHEMA_V2 = listOf(
      "CREATE TABLE items_new(id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL UNIQUE, pkg TEXT NOT NULL, app_label TEXT NOT NULL, " +
        "sender TEXT, sender_key TEXT, conversation TEXT, conversation_key TEXT, title TEXT, text TEXT NOT NULL, " +
        "posted_at INTEGER NOT NULL, captured_at INTEGER NOT NULL, otp_expires_at INTEGER, " +
        "deleted_by_sender INTEGER NOT NULL DEFAULT 0, search TEXT NOT NULL, sms_hash TEXT)",
      "INSERT INTO items_new(id, hash, pkg, app_label, sender, sender_key, conversation, conversation_key, title, text, posted_at, " +
        "captured_at, otp_expires_at, deleted_by_sender, search) SELECT id, hash, pkg, app_label, sender, sender_key, conversation, " +
        "conversation_key, title, text, posted_at, captured_at, otp_expires_at, deleted_by_sender, search FROM items",
      "DROP TABLE items",
      "ALTER TABLE items_new RENAME TO items",
      "CREATE INDEX items_posted ON items(posted_at DESC)",
      "CREATE INDEX items_pkg ON items(pkg, posted_at DESC)",
      "CREATE INDEX items_conv ON items(conversation_key, posted_at DESC)",
      "CREATE INDEX items_otp ON items(otp_expires_at) WHERE otp_expires_at IS NOT NULL",
      "CREATE UNIQUE INDEX items_sms ON items(sms_hash) WHERE sms_hash IS NOT NULL",
      "CREATE TABLE txns(id INTEGER PRIMARY KEY, direction TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, " +
        "account TEXT NOT NULL, counterparty TEXT, tx_id TEXT, at INTEGER NOT NULL, " +
        "own INTEGER NOT NULL DEFAULT 0, own_set INTEGER NOT NULL DEFAULT 0, pair_id INTEGER)",
      "CREATE INDEX txns_at ON txns(at DESC, id DESC)",
      "CREATE INDEX txns_match ON txns(amount_minor, at)",
      "CREATE INDEX txns_txid ON txns(tx_id) WHERE tx_id IS NOT NULL",
      "CREATE TABLE txn_sources(txn_id INTEGER NOT NULL, item_id INTEGER NOT NULL UNIQUE, channel TEXT NOT NULL, tx_id TEXT, at INTEGER NOT NULL)",
      "CREATE INDEX txn_sources_txn ON txn_sources(txn_id)",
    )

    // Not idempotent, like v2: ensureSchema runs it once. email_hash/email_text hold a Gmail message and the notification it merged with.
    private val SCHEMA_V3 = listOf(
      "ALTER TABLE items ADD COLUMN email_hash TEXT",
      "ALTER TABLE items ADD COLUMN email_text TEXT",
      "CREATE UNIQUE INDEX items_email ON items(email_hash) WHERE email_hash IS NOT NULL",
      "CREATE TABLE gmail_senders(query TEXT PRIMARY KEY, uid_validity INTEGER, last_uid INTEGER NOT NULL DEFAULT 0)",
    )

    // Not idempotent, like v2 and v3. ai_keys holds the owner's API keys in this SQLCipher file (R23): a future export must skip it.
    private val SCHEMA_V4 = listOf(
      "CREATE TABLE ai_results(item_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, summary TEXT NOT NULL, importance TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL)",
      "CREATE TABLE ai_queue(item_id INTEGER PRIMARY KEY, at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0)",
      "CREATE TABLE ai_blocks(block_key TEXT PRIMARY KEY)",
      "CREATE TABLE ai_keys(id INTEGER PRIMARY KEY AUTOINCREMENT, base_url TEXT NOT NULL, api_key TEXT NOT NULL)",
      "CREATE TABLE ai_spend(day TEXT PRIMARY KEY, usd REAL NOT NULL)",
      "CREATE TABLE todos(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, text TEXT NOT NULL, due_at INTEGER, done INTEGER NOT NULL DEFAULT 0)",
      "CREATE INDEX todos_due ON todos(done, due_at)",
      "ALTER TABLE txns ADD COLUMN category TEXT",
      "ALTER TABLE txns ADD COLUMN label TEXT",
      "ALTER TABLE txns ADD COLUMN by_ai INTEGER NOT NULL DEFAULT 0",
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
          if (db.version < 1) SCHEMA_V1.forEach(db::execSQL)
          if (db.version < 2) SCHEMA_V2.forEach(db::execSQL)
          if (db.version < 3) SCHEMA_V3.forEach(db::execSQL)
          SCHEMA_V4.forEach(db::execSQL)
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
