package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.BackfillItem
import expo.modules.inflowcore.core.BackfillStore
import expo.modules.inflowcore.core.LedgerBackfill

/** Reads items for LedgerBackfill with a keyset query (no OFFSET): each batch starts right after the last (posted_at, id) it saw. */
class SqlBackfillStore(private val store: SqlItemStore, private val smsPackages: Set<String>) : BackfillStore {
  override fun meta(key: String) = store.meta(key)

  override fun setMeta(key: String, value: String) = store.setMeta(key, value)

  override fun <T> inTransaction(block: () -> T): T = store.inTransaction(block)

  override fun unparsed(afterPostedAt: Long, afterId: Long, limit: Int): List<BackfillItem> =
    store.query(UNPARSED_SQL, afterPostedAt, afterPostedAt, afterId, limit.toLong()).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(BackfillItem(c.getLong(0), c.getLong(1), c.getString(2), LedgerBackfill.channelOf(c.getString(3), c.getInt(4) != 0, c.getInt(5) != 0, smsPackages)))
        }
      }
    }

  companion object {
    // An OTP row, a row already tied to a transaction and a blank one are never read. Rows that do not parse stay sourceless; the cursor moves past them.
    internal const val UNPARSED_SQL =
      "SELECT i.id, i.posted_at, COALESCE(i.email_text, i.text), i.pkg, i.sms_hash IS NOT NULL, i.email_hash IS NOT NULL FROM items i " +
        "WHERE (i.posted_at > ? OR (i.posted_at = ? AND i.id > ?)) AND i.otp_expires_at IS NULL " +
        "AND NOT EXISTS (SELECT 1 FROM txn_sources s WHERE s.item_id = i.id) AND trim(COALESCE(i.email_text, i.text)) <> '' " +
        "ORDER BY i.posted_at, i.id LIMIT ?"
  }
}
