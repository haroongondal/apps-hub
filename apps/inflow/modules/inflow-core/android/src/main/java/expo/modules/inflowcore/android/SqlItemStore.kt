package expo.modules.inflowcore.android

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteException
import expo.modules.inflowcore.core.AiChannels
import expo.modules.inflowcore.core.AiInput
import expo.modules.inflowcore.core.AiMeta
import expo.modules.inflowcore.core.AiResult
import expo.modules.inflowcore.core.AiStore
import expo.modules.inflowcore.core.AppRow
import expo.modules.inflowcore.core.AppRows
import expo.modules.inflowcore.core.AppSetting
import expo.modules.inflowcore.core.AppStat
import expo.modules.inflowcore.core.AskItem
import expo.modules.inflowcore.core.Channel
import expo.modules.inflowcore.core.Capture
import expo.modules.inflowcore.core.Categories
import expo.modules.inflowcore.core.DeferredDeletes
import expo.modules.inflowcore.core.Email
import expo.modules.inflowcore.core.ItemStore
import expo.modules.inflowcore.core.LegacyAction
import expo.modules.inflowcore.core.LegacyRepair
import expo.modules.inflowcore.core.LegacyRow
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
import java.io.File

class SqlItemStore private constructor(internal val db: SQLiteDatabase, private val mediaDir: File, private val openDir: File) : ItemStore, AiStore {
  override fun nameFor(tag: String): String? =
    query("SELECT name FROM chat_map WHERE tag = ?", tag).use { if (it.moveToFirst()) it.getString(0) else null }

  override fun learn(tag: String, name: String) {
    run("INSERT INTO chat_map(tag, name) VALUES (?, ?) ON CONFLICT(tag) DO UPDATE SET name = excluded.name", tag, name)
  }

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

  // The send-time filter (also behind queuedCount): the item still exists, is no OTP, is SMS or email (R44), was posted after the first key, its app records, and neither app nor sender is blocked.
  // A row that fails it is deleted first, so an item blocked or left out at send time can never go out later (unblocking does not bring it back).
  override fun queued(limit: Int): List<AiInput> {
    val since = enabledSince() ?: return emptyList()
    run("DELETE FROM ai_queue WHERE item_id NOT IN (SELECT i.id FROM items i WHERE i.posted_at >= ? AND $NEVER_SEND_FILTER)", since)
    return query(
      "SELECT i.id, i.app_label, COALESCE(n.name, i.sender), i.title, COALESCE(i.email_text, i.text), i.posted_at, i.conversation, lower(i.sender) = 'you', i.conversation_key $QUEUE_FROM ORDER BY q.at, q.item_id LIMIT ?",
      since, limit.toLong(),
    ).use { c -> buildList { while (c.moveToNext()) add(AiInput(c.getLong(0), c.getString(1), c.str(2), c.str(3), c.getString(4), c.getLong(5), c.str(6), c.getInt(7) != 0, c.str(8))) } }
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

  /** Done ones last. A to-do whose item is gone or is an expired OTP is not listed; one the owner added by hand (item_id 0) always is. */
  fun listTodos(includeDone: Boolean, now: Long): List<Map<String, Any?>> =
    query(
      "SELECT t.id, t.item_id, t.text, t.due_at, t.done FROM todos t LEFT JOIN items i ON i.id = t.item_id " +
        "WHERE (t.item_id = $MANUAL_TODO OR (i.id IS NOT NULL AND $VISIBLE_I))${if (includeDone) "" else " AND t.done = 0"} " +
        "ORDER BY t.done, t.due_at IS NULL, t.due_at, t.id",
      now,
    ).use { c -> buildList { while (c.moveToNext()) add(c.toTodo()) } }

  fun addTodo(text: String, dueAt: Long?) {
    run("INSERT INTO todos(item_id, text, due_at) VALUES ($MANUAL_TODO, ?, ?)", text, dueAt)
  }

  fun updateTodo(id: Long, text: String, dueAt: Long?) {
    run("UPDATE todos SET text = ?, due_at = ? WHERE id = ?", text, dueAt, id)
  }

  fun deleteTodo(id: Long) {
    run("DELETE FROM todos WHERE id = ?", id)
  }

  override fun markDeletedBySender(pkg: String, conversationKey: String?, sender: String?, postedAt: Long): Boolean =
    run(
      "UPDATE items SET deleted_by_sender = 1 WHERE pkg = ? AND conversation_key IS ? AND sender IS ? AND posted_at = ?",
      pkg, conversationKey, sender, postedAt,
    ) > 0

  override fun purgeExpiredOtps(now: Long): Int = transaction {
    forgetMedia("otp_expires_at IS NOT NULL AND otp_expires_at <= ?", now)
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
    keepNeverSent("pkg = ? AND posted_at < ?", pkg, cutoff)
    forgetAi("pkg = ? AND posted_at < ?", pkg, cutoff)
    forgetMedia("pkg = ? AND posted_at < ?", pkg, cutoff)
    tombstoneEmails("pkg = ? AND posted_at < ?", pkg, cutoff)
    run("DELETE FROM items WHERE pkg = ? AND posted_at < ?", pkg, cutoff)
  }

  override fun deleteApp(pkg: String): Int = transaction {
    keepNeverSent("pkg = ?", pkg)
    forgetAi("pkg = ?", pkg)
    forgetMedia("pkg = ?", pkg)
    tombstoneEmails("pkg = ?", pkg)
    run("DELETE FROM items WHERE pkg = ?", pkg)
  }

  override fun deleteItem(id: Long): Boolean = transaction { removeByOwner("id = ?", id) > 0 }

  override fun deleteConversation(key: String): Int = transaction { removeByOwner("conversation_key = ?", key) }

  // The owner's deletion: like retention, plus the item's own, SMS and email hashes are tombstoned so an inbox sync or a mailbox re-read cannot bring it back.
  // Not the text hash: a later message with the same words is a new message.
  private fun removeByOwner(where: String, vararg args: Any?): Int {
    keepNeverSent(where, *args)
    forgetAi(where, *args)
    forgetMedia(where, *args)
    val now = System.currentTimeMillis()
    run("INSERT OR IGNORE INTO tombstones(hash, at) SELECT hash, ? FROM items WHERE $where", now, *args)
    run("INSERT OR IGNORE INTO tombstones(hash, at) SELECT sms_hash, ? FROM items WHERE sms_hash IS NOT NULL AND $where", now, *args)
    tombstoneEmails(where, *args)
    return run("DELETE FROM items WHERE $where", *args)
  }

  // A transaction's never-send decision is read through its source item, which these deletions remove. Before the item goes, leave a
  // tombstone for each source the owner kept from the AI (OTP, blocked app, sender or recording), so Ask AI still withholds the transaction.
  // Keyed by item id: items is AUTOINCREMENT, so the id is never reused.
  private fun keepNeverSent(where: String, vararg args: Any?) {
    run(
      "INSERT OR IGNORE INTO tombstones(hash, at) SELECT '$NEVER_SENT_PREFIX' || i.id, ? FROM items i " +
        "WHERE i.id IN (SELECT id FROM items WHERE $where) AND i.id IN (SELECT item_id FROM txn_sources) AND NOT ($NEVER_SEND_FILTER)",
      System.currentTimeMillis(), *args,
    )
  }

  // The AI result, queue entry and to-dos go with their item.
  private fun forgetAi(where: String, vararg args: Any?) {
    for (table in listOf("ai_results", "ai_queue", "todos")) run("DELETE FROM $table WHERE item_id IN (SELECT id FROM items WHERE $where)", *args)
  }

  // The media rows go with their items now; their files are deleted once the outermost transaction has committed (see transaction()).
  private val doomedFiles = ThreadLocal.withInitial { DeferredDeletes() }

  private fun forgetMedia(where: String, vararg args: Any?) {
    val items = "SELECT id FROM items WHERE $where"
    query("SELECT file FROM media WHERE item_id IN ($items)", *args).use { c -> while (c.moveToNext()) doomedFiles.get()!!.add(c.getString(0)) }
    run("DELETE FROM media WHERE item_id IN ($items)", *args)
  }

  /** Adds `by` to a numeric meta counter (media counters). */
  fun bump(key: String, by: Long) {
    run(
      "INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(v AS INTEGER) + ? AS TEXT)",
      key, by.toString(), by,
    )
  }

  /** Every media file name the database knows, for the orphan sweep. */
  fun mediaFiles(): Set<String> = query("SELECT file FROM media").use { c -> buildSet { while (c.moveToNext()) add(c.getString(0)) } }

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

  fun home(startOfDay: Long, now: Long, sms: Set<String>): Map<String, Any> {
    val conversations = query(HOME_CONVERSATIONS_SQL, startOfDay, now, now, now).use { c ->
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
    // Chat-like apps, counted over non-promotional senders only: an app with none drops out of the inbox (it stays in apps()).
    val inbox = AppRows.build(stats(startOfDay, now, excludePromo = true), sms).filter { it.byContact }.map { it.toMap() }
    val important = query(HOME_IMPORTANT_SQL, now - 7 * DAY_MS, now).use { c -> buildList { while (c.moveToNext()) add(c.toItem()) } }
    // Not done, due from the start of today (soonest first) or undated and from the last 3 days (after the dated ones).
    val comingUp = query(
      "SELECT t.id, t.item_id, t.text, t.due_at, t.done FROM todos t LEFT JOIN items i ON i.id = t.item_id " +
        "WHERE t.done = 0 AND (t.item_id = $MANUAL_TODO OR (i.id IS NOT NULL AND $VISIBLE_I)) " +
        "AND ((t.due_at IS NOT NULL AND t.due_at >= ?) OR (t.due_at IS NULL AND (t.item_id = $MANUAL_TODO OR i.posted_at >= ?))) " +
        "ORDER BY t.due_at IS NULL, t.due_at, t.id LIMIT 5",
      now, startOfDay, now - 3 * DAY_MS,
    ).use { c -> buildList { while (c.moveToNext()) add(c.toTodo()) } }
    val hasItems = query(HAS_ITEMS_SQL, now).use { it.moveToFirst() && it.getInt(0) != 0 }
    return mapOf("conversations" to conversations, "inbox" to inbox, "important" to important, "comingUp" to comingUp, "hasItems" to hasItems)
  }

  /** Every app, newest first; same-label apps that are not contact apps are one row. */
  fun apps(startOfDay: Long, now: Long, sms: Set<String>): List<Map<String, Any>> =
    AppRows.build(stats(startOfDay, now, excludePromo = false), sms).map { it.toMap() }

  private fun stats(startOfDay: Long, now: Long, excludePromo: Boolean): List<AppStat> =
    query(statsSql(excludePromo), startOfDay, now).use { c ->
      buildList { while (c.moveToNext()) add(AppStat(c.getString(0), c.getString(1), c.getLong(2), c.getInt(3), c.getInt(4) != 0)) }
    }

  private fun AppRow.toMap(): Map<String, Any> = mapOf("label" to label, "pkgs" to pkgs, "lastAt" to lastAt, "today" to today, "byContact" to byContact)

  /**
   * One row per contact of one app, newest first: a chat (with the owner's own replies), else the sender. SQLite takes the bare
   * columns from the row that holds MAX(posted_at), so the name and last text come from the newest visible item.
   * promo false = the main list (promotional senders left out), true = only the promotional ones.
   */
  fun contacts(pkg: String, startOfDay: Long, now: Long, before: Long?, beforeKey: String?, limit: Int, promo: Boolean): List<Map<String, Any?>> {
    val args = mutableListOf<Any?>(startOfDay, pkg, now)
    if (before != null) { args += before; args += before; args += beforeKey ?: "" }
    args += limit.toLong()
    return query(contactsSql(promo, before != null), *args.toTypedArray()).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(mapOf("key" to c.getString(0), "name" to c.getString(1), "lastText" to c.getString(2), "lastAt" to c.getLong(3), "today" to c.getInt(4)))
        }
      }
    }
  }

  /** The senders of one app that are folded into Promotions, with the newest visible item among them. */
  fun promotions(pkg: String, now: Long): Map<String, Any?> =
    query(PROMOTIONS_SQL, pkg, now).use { c ->
      c.moveToFirst()
      mapOf("senders" to c.getInt(0), "lastAt" to if (c.isNull(1)) null else c.getLong(1))
    }

  /** Null: the item is gone or not an SMS item, so there is nothing to choose. Else whether its sender is in Promotions now. */
  fun smsPromotion(itemId: Long): Boolean? =
    query(SMS_PROMOTION_SQL, itemId).use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getInt(0) != 0 else null }

  fun setPromotion(key: String, promotional: Boolean) {
    run(SET_PROMOTION_SQL, key, if (promotional) 1L else 0L)
  }

  fun list(filter: Map<String, Any?>, before: Long?, limit: Int, now: Long, beforeId: Long? = null): List<Map<String, Any?>> {
    val where = mutableListOf(VISIBLE_I)
    val args = mutableListOf<Any?>(now)
    when (filter["kind"] as? String) {
      "app" -> { where += "i.pkg = ?"; args += filter["pkg"] as? String }
      "apps" -> {
        val pkgs = (filter["pkgs"] as? List<*>)?.filterIsInstance<String>().orEmpty()
        where += if (pkgs.isEmpty()) "0 = 1" else "i.pkg IN (${pkgs.joinToString(",") { "?" }})"
        args.addAll(pkgs)
      }
      "conversation" -> { where += "i.conversation_key = ?"; args += filter["key"] as? String }
      "contact" -> {
        where += "i.pkg = ? AND COALESCE(i.conversation_key, i.sender_key) = ?"
        args += filter["pkg"] as? String; args += filter["key"] as? String
      }
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
    var committed = false
    try {
      val result = block()
      db.setTransactionSuccessful()
      committed = true
      return result
    } finally {
      var ended = false
      try {
        db.endTransaction()
        ended = true
      } finally {
        // A failed end counts as a rollback and is always the last one: nothing queued may be deleted.
        val files = doomedFiles.get()!!.ended(committed && ended, outermost = !ended || !db.inTransaction())
        MediaStore.deleteFiles(mediaDir, files, openDir)
      }
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
    "mediaCount" to getInt(17),
  )

  private fun Cursor.toTodo(): Map<String, Any?> =
    mapOf("id" to getLong(0), "itemId" to getLong(1), "text" to getString(2), "dueAt" to if (isNull(3)) null else getLong(3), "done" to (getInt(4) != 0))

  private fun Cursor.str(i: Int): String? = if (isNull(i)) null else getString(i)

  private fun Cursor.toSetting() = AppSetting(getString(0), getString(1), getInt(2) != 0, if (isNull(3)) null else getInt(3))

  companion object {
    private const val DB_NAME = "inflow.db"
    private const val SCHEMA_VERSION = 8
    private const val GENERIC_FAILURE =
      "Inflow can't open your saved history. The history file is kept, not deleted. Restart the phone and try again."
    private const val ITEM_COLUMNS = "i.id, i.pkg, i.app_label, i.sender, i.sender_key, COALESCE(n.name, i.sender), i.conversation, " +
      "i.conversation_key, i.title, i.text, i.posted_at, i.deleted_by_sender, i.email_text, r.kind, r.summary, r.importance, r.tags, " +
      "(SELECT COUNT(*) FROM media m WHERE m.item_id = i.id)"
    private const val ITEM_FROM = "FROM items i LEFT JOIN sender_names n ON n.sender_key = i.sender_key LEFT JOIN ai_results r ON r.item_id = i.id"
    // What may be sent to the AI (R29 and the global constraint): the app records, and neither the app nor the sender is blocked.
    internal const val SENDABLE = "COALESCE((SELECT a.record FROM apps a WHERE a.pkg = i.pkg), 1) = 1 " +
      "AND NOT EXISTS (SELECT 1 FROM ai_blocks b WHERE b.block_key = 'app:' || i.pkg) " +
      "AND (i.sender_key IS NULL OR NOT EXISTS (SELECT 1 FROM ai_blocks b WHERE b.block_key = 'sender:' || i.sender_key))"
    // R44: only SMS and email go to the AI. sms_hash/email_hash cover the default SMS app and Gmail whatever the package; the package list is AiChannels.PKGS.
    private val SMS_OR_EMAIL = "(i.sms_hash IS NOT NULL OR i.email_hash IS NOT NULL OR i.pkg IN (${AiChannels.SQL_LIST}))"
    internal const val NEVER_SENT_PREFIX = "nosend:"
    internal val NEVER_SEND_FILTER = "i.otp_expires_at IS NULL AND $SMS_OR_EMAIL AND $SENDABLE"
    private val QUEUE_FROM = "FROM ai_queue q JOIN items i ON i.id = q.item_id LEFT JOIN sender_names n ON n.sender_key = i.sender_key " +
      "WHERE i.posted_at >= ? AND $NEVER_SEND_FILTER"
    private const val DAY_MS = 86_400_000L
    // item_id of a to-do the owner added by hand: no item has id 0 (AUTOINCREMENT starts at 1).
    private const val MANUAL_TODO = 0
    private const val VISIBLE_I = "(i.otp_expires_at IS NULL OR i.otp_expires_at > ?)"
    private const val VISIBLE_J = "(j.otp_expires_at IS NULL OR j.otp_expires_at > ?)"
    private const val VISIBLE_T = "(t.otp_expires_at IS NULL OR t.otp_expires_at > ?)"

    // Quieter SMS. An SMS item is one with an sms_hash or from a known SMS app; only these senders can be promotional.
    internal fun smsItem(a: String) = "($a.sms_hash IS NOT NULL OR $a.pkg IN (${Sms.KNOWN_APPS.joinToString(",") { "'$it'" }}))"
    internal val SMS_ITEM = smsItem("i")

    // The keys (conversation key, else sender key) of promotional SMS senders: the owner's choice (sender_promo) wins; else more than half of the sender's
    // AI-read items are kind 'promotion' and none of its items is a transaction source (a bank stays visible). No parameters.
    // shortcut: has_txn only sees items still stored; retention (keep-days on SMS) deletes old ones, so a bank whose remaining recent items are mostly promotions could fold. The owner's "Keep in my list" fixes it.
    // shortcut: recomputed per query; switch to a stored flag if Home takes over ~300 ms on the phone.
    internal val PROMO_KEYS = "SELECT s.k FROM (SELECT COALESCE(i.conversation_key, i.sender_key) AS k, COUNT(r.item_id) AS ai_read, SUM(r.kind = 'promotion') AS promo, " +
      "MAX(EXISTS(SELECT 1 FROM txn_sources x WHERE x.item_id = i.id)) AS has_txn FROM items i LEFT JOIN ai_results r ON r.item_id = i.id " +
      "WHERE $SMS_ITEM AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL GROUP BY k) s LEFT JOIN sender_promo o ON o.sender_key = s.k " +
      "WHERE COALESCE(o.promo, s.ai_read >= 1 AND s.promo * 2 > s.ai_read AND s.has_txn = 0) = 1"

    /** False only for an SMS item whose contact key is promotional: other apps sharing a num: key (a WhatsApp chat with an unsaved number) are never folded. */
    internal fun notPromo(a: String) =
      "(NOT ${smsItem(a)} OR COALESCE($a.conversation_key, $a.sender_key) IS NULL OR COALESCE($a.conversation_key, $a.sender_key) NOT IN ($PROMO_KEYS))"

    /** SQL twin of GenericTitle. shortcut: the GLOB also matches "5x new message"; fine for notification titles seen so far. */
    internal fun GENERIC_SQL(expr: String) =
      "(lower(trim($expr)) GLOB '[0-9]* new message' OR lower(trim($expr)) GLOB '[0-9]* new messages' OR lower(trim($expr)) IN ('new message', 'new messages'))"

    private fun usable(x: String) = "CASE WHEN ${GENERIC_SQL(x)} THEN NULL ELSE $x END"

    // A short code (num: plus at most 6 digits) is named after its bank: the account text of its newest transaction without the trailing digits ("Alfalah 2310" is "Alfalah").
    private fun bank(k: String) =
      "CASE WHEN $k LIKE 'num:%' AND length($k) <= 10 THEN (SELECT NULLIF(trim(rtrim(t.account, '0123456789')), '') FROM items b " +
        "JOIN txn_sources s ON s.item_id = b.id JOIN txns t ON t.id = s.txn_id WHERE b.sender_key = $k ORDER BY t.at DESC, t.id DESC LIMIT 1) END"

    // The owner's rename (n.name) wins, then the bank, then the chat name or sender unless generic or "You", then the app, then the key.
    private fun displayName(conversation: String, sender: String, appLabel: String, k: String) =
      "COALESCE(n.name, ${bank(k)}, ${usable(conversation)}, CASE WHEN lower($sender) = 'you' THEN NULL ELSE ${usable(sender)} END, $appLabel, $k)"

    internal val HOME_CONVERSATIONS_SQL =
      "SELECT i.conversation_key, i.pkg, i.app_label, ${displayName("i.conversation", "i.sender", "i.app_label", "i.conversation_key")}, i.text, i.posted_at, " +
        "(SELECT COUNT(*) FROM items t WHERE t.conversation_key = i.conversation_key AND t.posted_at >= ? AND $VISIBLE_T) " +
        "FROM items i LEFT JOIN sender_names n ON n.sender_key = i.conversation_key " +
        "WHERE i.conversation_key IS NOT NULL AND $VISIBLE_I AND ${notPromo("i")} " +
        "AND i.id = (SELECT j.id FROM items j WHERE j.conversation_key = i.conversation_key AND $VISIBLE_J AND ${notPromo("j")} " +
        "ORDER BY j.posted_at DESC, j.id DESC LIMIT 1) " +
        "ORDER BY i.posted_at DESC, i.id DESC LIMIT 5"

    // A transaction source lives in Money (one row per transaction), so it is never Important; nor is a promotional sender.
    internal val HOME_IMPORTANT_SQL =
      "SELECT $ITEM_COLUMNS $ITEM_FROM WHERE r.importance = 'high' AND i.posted_at >= ? AND $VISIBLE_I " +
        "AND NOT EXISTS (SELECT 1 FROM txn_sources ts WHERE ts.item_id = i.id) AND ${notPromo("i")} ORDER BY i.posted_at DESC, i.id DESC LIMIT 5"

    internal fun statsSql(excludePromo: Boolean) =
      "SELECT i.pkg, COALESCE(a.label, MAX(i.app_label)), MAX(i.posted_at), SUM(CASE WHEN i.posted_at >= ? THEN 1 ELSE 0 END), " +
        "MAX(i.conversation_key IS NOT NULL) FROM items i LEFT JOIN apps a ON a.pkg = i.pkg WHERE $VISIBLE_I " +
        "${if (excludePromo) "AND ${notPromo("i")} " else ""}GROUP BY i.pkg ORDER BY MAX(i.posted_at) DESC"

    // Keyset (last, k), the same for both lists; the two lists never share a key.
    internal fun contactsSql(promo: Boolean, paged: Boolean) =
      "SELECT g.k, ${displayName("g.conversation", "g.sender", "g.app_label", "g.k")}, g.text, g.last, g.today FROM (" +
        "SELECT COALESCE(i.conversation_key, i.sender_key) AS k, i.conversation AS conversation, i.sender AS sender, i.app_label AS app_label, i.text AS text, " +
        "MAX(i.posted_at) AS last, SUM(CASE WHEN i.posted_at >= ? THEN 1 ELSE 0 END) AS today FROM items i " +
        "WHERE i.pkg = ? AND $VISIBLE_I AND COALESCE(i.conversation_key, i.sender_key) IS NOT NULL AND ${if (promo) "NOT " else ""}${notPromo("i")} GROUP BY k) g " +
        "LEFT JOIN sender_names n ON n.sender_key = g.k ${if (paged) "WHERE (g.last < ? OR (g.last = ? AND g.k < ?)) " else ""}ORDER BY g.last DESC, g.k DESC LIMIT ?"

    internal val PROMOTIONS_SQL =
      "SELECT COUNT(DISTINCT COALESCE(i.conversation_key, i.sender_key)), MAX(i.posted_at) FROM items i WHERE i.pkg = ? AND $VISIBLE_I AND NOT ${notPromo("i")}"

    // Null: the item is gone or not an SMS item (or has no key).
    internal val SMS_PROMOTION_SQL =
      "SELECT CASE WHEN $SMS_ITEM THEN COALESCE(i.conversation_key, i.sender_key) IN ($PROMO_KEYS) END FROM items i WHERE i.id = ?"

    internal const val HAS_ITEMS_SQL = "SELECT EXISTS(SELECT 1 FROM items i WHERE $VISIBLE_I)"

    internal const val SET_PROMOTION_SQL = "INSERT INTO sender_promo(sender_key, promo) VALUES (?, ?) ON CONFLICT(sender_key) DO UPDATE SET promo = excluded.promo"
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

    // Not idempotent, like the others. chat_map: chat id -> contact name (R36). media: one row per stored file (the same bytes under two items are two files), its bytes live encrypted in filesDir/media (K4).
    private val SCHEMA_V5 = listOf(
      "CREATE TABLE chat_map(tag TEXT PRIMARY KEY, name TEXT NOT NULL)",
      "CREATE TABLE media(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, " +
        "size INTEGER NOT NULL, file TEXT NOT NULL, sha TEXT NOT NULL, at INTEGER NOT NULL, UNIQUE(item_id, sha))",
      "CREATE INDEX media_item ON media(item_id)",
    )

    // Not idempotent, like the others. category_set: the owner chose the category (no AI path changes it). category_tries: how often the categoriser has tried this txn.
    // reports: one row per period (a "so far" week is partial); json is the validated report, headline the notification line.
    internal val SCHEMA_V6 = listOf(
      "ALTER TABLE txns ADD COLUMN category_set INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE txns ADD COLUMN category_tries INTEGER NOT NULL DEFAULT 0",
      "CREATE TABLE reports(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, period_start INTEGER NOT NULL, period_end INTEGER NOT NULL, " +
        "partial INTEGER NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL, message TEXT, tries INTEGER NOT NULL DEFAULT 0, headline TEXT, json TEXT)",
      "CREATE UNIQUE INDEX reports_period ON reports(kind, period_start, partial)",
    )

    // Not idempotent, like the others. sender_promo: the owner's choice per sender key (1 = Move to Promotions, 0 = Keep in my list); it wins over the AI-based rule.
    // items_sender serves the bank-name lookup of a short-code sender (an SMS notification merged by setSmsHash can have no conversation_key).
    private val SCHEMA_V7 = listOf(
      "CREATE TABLE sender_promo(sender_key TEXT PRIMARY KEY, promo INTEGER NOT NULL)",
      "CREATE INDEX items_sender ON items(sender_key)",
    )

    // Not idempotent, like the others. ai_queue.fast: Autopilot's fast path marks a row it wants sent soon (nothing reads it yet).
    // suggestions: what Autopilot offers the owner. kind and state are enum names; no foreign key on item_id (retention deletes items, a suggestion outlives them until it expires).
    internal val SCHEMA_V8 = listOf(
      "ALTER TABLE ai_queue ADD COLUMN fast INTEGER NOT NULL DEFAULT 0",
      "CREATE TABLE suggestions(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL, item_id INTEGER NOT NULL, due_at INTEGER, " +
        "dedupe_key TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
      "CREATE INDEX suggestions_state ON suggestions(state)",
    )

    // Runs after SCHEMA_V6, in its transaction: the old names become the new ones (money out), and a money-in txn holding a name that is not a money-in category is cleared to be categorised again.
    internal const val V6_RENAME = "UPDATE txns SET category = ? WHERE category = ? AND direction = 'OUT'"
    internal val V6_CLEAR_IN = "UPDATE txns SET category = NULL WHERE direction = 'IN' AND category IS NOT NULL AND category NOT IN (${Categories.IN.joinToString { "?" }})"

    private fun migrateCategories(db: SQLiteDatabase) {
      for ((old, new) in Categories.RENAMED) db.execSQL(V6_RENAME, arrayOf<Any?>(new, old))
      db.execSQL(V6_CLEAR_IN, Categories.IN.toTypedArray<Any?>())
    }

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
        Result.success(SqlItemStore(db, File(context.filesDir, "media"), File(context.cacheDir, "open")))
      } catch (e: SQLiteDatabaseCorruptException) {
        Result.failure(IllegalStateException(KEY_LOST_MESSAGE, e))
      } catch (e: Exception) {
        Result.failure(IllegalStateException(GENERIC_FAILURE, e))
      } catch (e: UnsatisfiedLinkError) {
        Result.failure(IllegalStateException(GENERIC_FAILURE, e))
      }
    }

    // Carries out LegacyRepair.plan inside the v5 transaction. A delete only ever follows a plan that names an identical twin;
    // an item that is a ledger source or has to-dos is never deleted (the plan knows via LegacyRow.inUse), and a move whose new hash is taken is skipped (UPDATE OR IGNORE).
    private fun repairLegacyWhatsapp(db: SQLiteDatabase) {
      val rows = db.rawQuery(
        "SELECT id, pkg, sender, conversation_key, conversation, title, text, posted_at, captured_at, " +
          "EXISTS(SELECT 1 FROM txn_sources s WHERE s.item_id = items.id) OR EXISTS(SELECT 1 FROM todos t WHERE t.item_id = items.id) " +
          "FROM items WHERE pkg = ?",
        LegacyRepair.PKG,
      ).use { c ->
        buildList {
          while (c.moveToNext()) {
            add(
              LegacyRow(
                c.getLong(0), c.getString(1), c.getString(2), c.getString(3), c.getString(4), c.getString(5), c.getString(6),
                c.getLong(7), c.getLong(8), c.getInt(9) != 0,
              ),
            )
          }
        }
      }
      for (a in LegacyRepair.plan(rows)) {
        when (a) {
          is LegacyAction.Move -> db.execSQL(
            "UPDATE OR IGNORE items SET conversation = ?, conversation_key = ?, hash = ?, search = ? WHERE id = ?",
            arrayOf<Any?>(a.conversation, a.conversationKey, a.hash, a.search, a.id),
          )
          is LegacyAction.Delete -> {
            for (table in listOf("ai_results", "ai_queue", "todos")) db.execSQL("DELETE FROM $table WHERE item_id = ?", arrayOf<Any?>(a.id))
            db.execSQL("DELETE FROM items WHERE id = ?", arrayOf<Any?>(a.id))
          }
        }
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
          if (db.version < 4) SCHEMA_V4.forEach(db::execSQL)
          if (db.version < 5) {
            SCHEMA_V5.forEach(db::execSQL)
            repairLegacyWhatsapp(db)
          }
          if (db.version < 6) {
            SCHEMA_V6.forEach(db::execSQL)
            migrateCategories(db)
          }
          if (db.version < 7) SCHEMA_V7.forEach(db::execSQL)
          if (db.version < 8) SCHEMA_V8.forEach(db::execSQL)
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
