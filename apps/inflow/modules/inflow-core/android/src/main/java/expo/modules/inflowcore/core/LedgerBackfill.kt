package expo.modules.inflowcore.core

data class BackfillItem(val id: Long, val postedAt: Long, val text: String, val channel: Channel)

interface BackfillStore {
  fun meta(key: String): String?
  fun setMeta(key: String, value: String)
  fun <T> inTransaction(block: () -> T): T
  /** Items with no ledger source, no OTP expiry and non-blank text (email text first), ordered by (postedAt, id), strictly after the cursor. */
  fun unparsed(afterPostedAt: Long, afterId: Long, limit: Int): List<BackfillItem>
}

/**
 * R45: whenever the bank patterns change, every saved item that has no ledger source is read again once, oldest first, so past
 * transactions appear. It only adds ledger rows (never touches items), keeps its place in meta after every batch, and is done
 * once `ledgerPatternsVersion` equals VERSION.
 */
class LedgerBackfill(private val store: BackfillStore, private val ledger: Ledger, private val now: () -> Long) {
  /** Items this instance tied to a transaction. */
  var linked = 0
    private set

  /** One batch in one transaction; true when more remain. */
  fun runBatch(limit: Int = 100): Boolean {
    if (store.meta(VERSION_KEY) == VERSION.toString()) return false
    val (afterAt, afterId) = store.meta(CURSOR_KEY)?.split(':')?.takeIf { it.size == 2 }
      ?.let { (a, i) -> (a.toLongOrNull() ?: 0L) to (i.toLongOrNull() ?: 0L) } ?: (Long.MIN_VALUE to 0L)
    val batch = store.inTransaction {
      val items = store.unparsed(afterAt, afterId, limit)
      for (it in items) if (ledger.onItem(it.id, it.text, it.channel, it.postedAt) != null) linked++
      items.lastOrNull()?.let { store.setMeta(CURSOR_KEY, "${it.postedAt}:${it.id}") }
      items
    }
    if (batch.size == limit) return true
    store.inTransaction {
      ledger.ownerNameChanged(null)   // own-name matching for the transactions just added
      store.setMeta(CURSOR_KEY, "")
      store.setMeta(DONE_AT_KEY, now().toString())
      store.setMeta(VERSION_KEY, VERSION.toString())
    }
    return false
  }

  companion object {
    /** Bump whenever BankParser's patterns change: every saved item without a ledger source is then read once more. */
    const val VERSION = 2
    const val VERSION_KEY = "ledgerPatternsVersion"
    const val CURSOR_KEY = "backfillCursor"
    private const val DONE_AT_KEY = "backfillDoneAt"

    fun channelOf(pkg: String, hasSmsHash: Boolean, hasEmailHash: Boolean, smsPackages: Set<String>): Channel = when {
      hasSmsHash -> Channel.SMS
      pkg in smsPackages -> Channel.SMS_NOTIFICATION
      hasEmailHash -> Channel.EMAIL
      pkg == Email.GMAIL -> Channel.EMAIL_NOTIFICATION
      else -> Channel.NOTIFICATION
    }
  }
}
