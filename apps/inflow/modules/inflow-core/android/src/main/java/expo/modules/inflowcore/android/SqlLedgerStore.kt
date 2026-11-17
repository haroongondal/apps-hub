package expo.modules.inflowcore.android

import android.database.Cursor
import expo.modules.inflowcore.core.Channel
import expo.modules.inflowcore.core.Direction
import expo.modules.inflowcore.core.LedgerStore
import expo.modules.inflowcore.core.Parsed
import expo.modules.inflowcore.core.Txn
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SQLiteStatement

/** Shares the item store's database, so one transaction covers an item and its transaction. No foreign key on item_id: retention deletes items, transactions stay. */
class SqlLedgerStore(private val db: SQLiteDatabase) : LedgerStore {
  override fun near(direction: Direction, amountMinor: Long, currency: String, from: Long, to: Long): List<Txn> =
    txns("t.direction = ? AND t.amount_minor = ? AND t.currency = ? AND t.at BETWEEN ? AND ?", direction.name, amountMinor, currency, from, to)

  override fun byTxId(txId: String): Txn? = txns("t.tx_id = ? ORDER BY t.id LIMIT 1", txId).firstOrNull()

  override fun get(id: Long): Txn? = txns("t.id = ?", id).firstOrNull()

  override fun paired(pairId: Long): List<Txn> = txns("t.pair_id = ?", pairId)


  override fun txnOfItem(itemId: Long): Long? =
    db.rawQuery("SELECT txn_id FROM txn_sources WHERE item_id = ?", itemId).use { if (it.moveToFirst()) it.getLong(0) else null }

  override fun add(p: Parsed, at: Long, own: Boolean, byAi: Boolean): Long =
    db.compileStatement(
      "INSERT INTO txns(direction, amount_minor, currency, account, counterparty, tx_id, at, own, own_set, by_ai) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
    ).use { st ->
      st.bind(1, p.direction.name); st.bind(2, p.amountMinor); st.bind(3, p.currency); st.bind(4, p.account)
      st.bind(5, p.counterparty); st.bind(6, p.txId); st.bind(7, at); st.bind(8, if (own) 1L else 0L); st.bind(9, if (byAi) 1L else 0L)
      st.executeInsert()
    }

  override fun addSource(txnId: Long, itemId: Long, channel: Channel, txId: String?, at: Long) {
    run("INSERT OR IGNORE INTO txn_sources(txn_id, item_id, channel, tx_id, at) VALUES (?, ?, ?, ?, ?)", txnId, itemId, channel.name, txId, at)
    run("UPDATE txns SET at = ? WHERE id = ? AND at > ?", at, txnId, at)
  }

  override fun setOwn(id: Long, own: Boolean, ownSet: Boolean, pairId: Long?) {
    run("UPDATE txns SET own = ?, own_set = ?, pair_id = ? WHERE id = ?", if (own) 1L else 0L, if (ownSet) 1L else 0L, pairId, id)
  }

  override fun setTxIdIfNull(id: Long, txId: String) {
    run("UPDATE txns SET tx_id = ? WHERE id = ? AND tx_id IS NULL", txId, id)
  }

  // The channel column holds a comma list, which txns() already splits; ',SMS,' is matched whole because 'SMS' is inside 'SMS_NOTIFICATION'.
  override fun addChannel(itemId: Long, channel: Channel) {
    run("UPDATE txn_sources SET channel = channel || ',' || ? WHERE item_id = ? AND instr(',' || channel || ',', ',' || ? || ',') = 0", channel.name, itemId, channel.name)
  }

  override fun accounts(): List<String> =
    db.rawQuery("SELECT DISTINCT account FROM txns").use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }

  /** The accounts the AI prompt may list (R44): only those of a transaction with a source that is not a bare push, so WhatsApp or bank-app accounts never leave the phone. */
  fun aiAccounts(): List<String> =
    db.rawQuery(
      "SELECT DISTINCT account FROM txns t WHERE EXISTS (SELECT 1 FROM txn_sources p WHERE p.txn_id = t.id AND NOT ($PUSH_SOURCE))",
    ).use { c -> buildList { while (c.moveToNext()) add(c.getString(0)) } }

  override fun setCounterpartyIfNull(id: Long, counterparty: String) {
    run("UPDATE txns SET counterparty = ? WHERE id = ? AND counterparty IS NULL", counterparty, id)
  }

  override fun setAiDetails(id: Long, category: String, label: String?) {
    run("UPDATE txns SET category = CASE WHEN category_set = 1 THEN category ELSE ? END, label = COALESCE(?, label) WHERE id = ?", category, label, id)
  }

  // Clearing also resets the categoriser's tries, so the AI picks the category up again.
  override fun setCategory(id: Long, category: String?) {
    val set = if (category != null) 1L else 0L
    run("UPDATE txns SET category = ?, category_set = ?, category_tries = CASE WHEN ? = 0 THEN 0 ELSE category_tries END WHERE id = ?", category, set, set, id)
  }

  override fun sourceCount(txnId: Long): Int =
    db.rawQuery("SELECT COUNT(*) FROM txn_sources WHERE txn_id = ?", txnId).use { if (it.moveToFirst()) it.getInt(0) else 0 }

  override fun deleteTxn(id: Long) {
    run("DELETE FROM txn_sources WHERE txn_id = ?", id)
    run("DELETE FROM txns WHERE id = ?", id)
  }

  override fun clearByAi(id: Long) {
    run("UPDATE txns SET by_ai = 0 WHERE id = ?", id)
  }

  /**
   * Ask AI (R35): the newest `limit` non-own transactions in the range, of any age (not only since the first key). One with a
   * source that is an OTP, or belongs to an app, sender or recording the owner kept from the AI, is left out. R44 also reads the source's
   * stored channel, which outlives a deleted item: a transaction with a push (NOTIFICATION) source is never sent, even once that item is gone.
   */
  fun askTxns(from: Long, to: Long, limit: Int): List<Txn> =
    txns(
      "t.own = 0 AND t.at BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM txn_sources s JOIN items i ON i.id = s.item_id " +
        "WHERE s.txn_id = t.id AND NOT (${SqlItemStore.NEVER_SEND_FILTER})) AND NOT EXISTS (SELECT 1 FROM txn_sources p WHERE p.txn_id = t.id AND $PUSH_SOURCE) " +
        "ORDER BY t.at DESC, t.id DESC LIMIT ?",
      from, to, limit.toLong(),
    )

  override fun undecided(): List<Txn> = txns("t.own_set = 0 AND t.pair_id IS NULL")

  /** Own transfers left out; per account and currency, never converted. */
  fun money(from: Long, to: Long): Map<String, Any> {
    val accounts = db.rawQuery(
      "SELECT account, currency, SUM(CASE direction WHEN 'IN' THEN amount_minor ELSE 0 END), " +
        "SUM(CASE direction WHEN 'OUT' THEN amount_minor ELSE 0 END), COUNT(*) " +
        "FROM txns WHERE own = 0 AND at >= ? AND at < ? GROUP BY account, currency ORDER BY account, currency",
      from, to,
    ).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(mapOf("account" to c.getString(0), "currency" to c.getString(1), "moneyIn" to c.getLong(2), "moneyOut" to c.getLong(3), "count" to c.getInt(4)))
        }
      }
    }
    val merchants = db.rawQuery(
      "SELECT counterparty, currency, SUM(amount_minor), COUNT(*) FROM txns " +
        "WHERE own = 0 AND direction = 'OUT' AND counterparty IS NOT NULL AND at >= ? AND at < ? " +
        "GROUP BY counterparty, currency ORDER BY SUM(amount_minor) DESC, counterparty LIMIT 10",
      from, to,
    ).use { c ->
      buildList {
        while (c.moveToNext()) add(mapOf("counterparty" to c.getString(0), "currency" to c.getString(1), "total" to c.getLong(2), "count" to c.getInt(3)))
      }
    }
    // Money out only. A transaction nobody has sorted yet (no AI result) is not in any category.
    val categories = db.rawQuery(
      "SELECT category, currency, SUM(amount_minor), COUNT(*) FROM txns " +
        "WHERE own = 0 AND direction = 'OUT' AND category IS NOT NULL AND at >= ? AND at < ? " +
        "GROUP BY category, currency ORDER BY SUM(amount_minor) DESC, category",
      from, to,
    ).use { c ->
      buildList {
        while (c.moveToNext()) add(mapOf("category" to c.getString(0), "currency" to c.getString(1), "total" to c.getLong(2), "count" to c.getInt(3)))
      }
    }
    // Every person or shop, both directions; own transfers are one row with no name. A blank name is "Unknown" on screen.
    val parties = db.rawQuery(
      "SELECT CASE WHEN own = 1 THEN NULL ELSE $PARTY END, own, currency, " +
        "SUM(CASE direction WHEN 'IN' THEN amount_minor ELSE 0 END), SUM(CASE direction WHEN 'OUT' THEN amount_minor ELSE 0 END), COUNT(*) " +
        "FROM txns WHERE at >= ? AND at < ? GROUP BY own, CASE WHEN own = 1 THEN '' ELSE $PARTY END, currency " +
        "ORDER BY SUM(amount_minor) DESC, 1",
      from, to,
    ).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(
            mapOf(
              "name" to c.str(0)?.ifEmpty { null }, "own" to (c.getInt(1) != 0), "currency" to c.getString(2),
              "moneyIn" to c.getLong(3), "moneyOut" to c.getLong(4), "count" to c.getInt(5),
            ),
          )
        }
      }
    }
    return mapOf("accounts" to accounts, "merchants" to merchants, "categories" to categories, "parties" to parties)
  }

  /** All-time totals with one person or shop (null name = Unknown), or of own transfers when own. */
  fun partyTotals(name: String?, own: Boolean): List<Map<String, Any>> {
    val (clause, args) = partyClause(name, own)
    return db.rawQuery(
      "SELECT t.currency, SUM(CASE t.direction WHEN 'IN' THEN t.amount_minor ELSE 0 END), " +
        "SUM(CASE t.direction WHEN 'OUT' THEN t.amount_minor ELSE 0 END), COUNT(*) FROM txns t WHERE $clause GROUP BY t.currency ORDER BY t.currency",
      *args,
    ).use { c ->
      buildList {
        while (c.moveToNext()) add(mapOf("currency" to c.getString(0), "moneyIn" to c.getLong(1), "moneyOut" to c.getLong(2), "count" to c.getInt(3)))
      }
    }
  }

  fun listPartyTxns(name: String?, own: Boolean, before: Long?, limit: Int, beforeId: Long?): List<Map<String, Any?>> {
    val (clause, args) = partyClause(name, own)
    return pageTxns(clause, args.toList(), before, limit, beforeId)
  }

  private fun partyClause(name: String?, own: Boolean): Pair<String, Array<Any?>> =
    if (own) "t.own = 1" to emptyArray() else "t.own = 0 AND COALESCE(t.label, t.counterparty, '') = ?" to arrayOf(name ?: "")

  /** Newest first; paging matches SqlItemStore.list. */
  fun listTxns(account: String?, before: Long?, limit: Int, beforeId: Long?): List<Map<String, Any?>> =
    if (account != null) pageTxns("t.account = ?", listOf(account), before, limit, beforeId) else pageTxns("1 = 1", emptyList(), before, limit, beforeId)

  private fun pageTxns(clause: String, clauseArgs: List<Any?>, before: Long?, limit: Int, beforeId: Long?): List<Map<String, Any?>> {
    val where = mutableListOf(clause)
    val args = clauseArgs.toMutableList()
    if (before != null) {
      if (beforeId != null) {
        where += "(t.at < ? OR (t.at = ? AND t.id < ?))"
        args += before; args += before; args += beforeId
      } else {
        where += "t.at < ?"; args += before
      }
    }
    args += limit.toLong()
    return db.rawQuery(
      "SELECT t.id, t.direction, t.amount_minor, t.currency, t.account, t.counterparty, t.tx_id, t.at, t.own, t.pair_id, " +
        "(SELECT group_concat(item_id) FROM txn_sources s WHERE s.txn_id = t.id), t.category, t.label, t.by_ai, t.category_set " +
        "FROM txns t WHERE ${where.joinToString(" AND ")} ORDER BY t.at DESC, t.id DESC LIMIT ?",
      *args.toTypedArray(),
    ).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(
            mapOf(
              "id" to c.getLong(0), "direction" to c.getString(1).lowercase(), "amount" to c.getLong(2), "currency" to c.getString(3),
              "account" to c.getString(4), "counterparty" to c.str(5), "txId" to c.str(6), "at" to c.getLong(7),
              "own" to (c.getInt(8) != 0), "paired" to !c.isNull(9),
              "itemIds" to (c.str(10)?.split(',')?.map { it.toLong() } ?: emptyList()),
              "category" to c.str(11), "label" to c.str(12), "byAi" to (c.getInt(13) != 0), "categorySet" to (c.getInt(14) != 0),
            ),
          )
        }
      }
    }
  }

  private fun txns(where: String, vararg args: Any?): List<Txn> =
    db.rawQuery(
      "SELECT t.id, t.direction, t.amount_minor, t.currency, t.account, t.counterparty, t.tx_id, t.at, t.own, t.own_set, t.pair_id, " +
        "(SELECT group_concat(channel) FROM txn_sources s WHERE s.txn_id = t.id), t.category, t.label, t.by_ai, t.category_set FROM txns t WHERE $where",
      *args,
    ).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(
            Txn(
              c.getLong(0), Direction.valueOf(c.getString(1)), c.getLong(2), c.getString(3), c.getString(4), c.str(5), c.str(6), c.getLong(7),
              c.getInt(8) != 0, c.getInt(9) != 0, if (c.isNull(10)) null else c.getLong(10),
              c.str(11)?.split(',')?.map { Channel.valueOf(it) }?.toSet() ?: emptySet(),
              c.str(12), c.str(13), c.getInt(14) != 0, c.getInt(15) != 0,
            ),
          )
        }
      }
    }

  private fun run(sql: String, vararg args: Any?) {
    db.compileStatement(sql).use { st ->
      args.forEachIndexed { i, a -> st.bind(i + 1, a) }
      st.executeUpdateDelete()
    }
  }

  private fun SQLiteStatement.bind(i: Int, a: Any?) {
    when (a) {
      null -> bindNull(i)
      is Long -> bindLong(i, a)
      else -> bindString(i, a.toString())
    }
  }

  private fun Cursor.str(i: Int): String? = if (isNull(i)) null else getString(i)

  private companion object {
    // The name a person or shop is grouped under: the AI's clean name, else the bank's text.
    const val PARTY = "COALESCE(label, counterparty, '')"
    // The channel column is a comma list; ',NOTIFICATION,' is a source that was a bare push (WhatsApp, a bank app), whatever became of its item.
    const val PUSH_SOURCE = "instr(',' || p.channel || ',', ',NOTIFICATION,') > 0"
  }
}
