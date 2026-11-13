package expo.modules.inflowcore.core

import java.util.Locale
import kotlin.math.abs

enum class Channel { SMS, SMS_NOTIFICATION, NOTIFICATION, EMAIL_NOTIFICATION, EMAIL }

data class Txn(
  val id: Long, val direction: Direction, val amountMinor: Long, val currency: String, val account: String,
  val counterparty: String?, val txId: String?, val at: Long,
  val own: Boolean, val ownSet: Boolean,   // ownSet = the owner chose `own` by hand; automation never changes it again
  val pairId: Long?, val channels: Set<Channel>,
)

interface LedgerStore {
  fun near(direction: Direction, amountMinor: Long, currency: String, from: Long, to: Long): List<Txn>
  fun byTxId(txId: String): Txn?
  fun get(id: Long): Txn?
  /** Every transaction carrying this pairId, so unlinking reaches the partner whichever side the owner tapped. */
  fun paired(pairId: Long): List<Txn>
  fun hasSource(itemId: Long): Boolean
  fun add(p: Parsed, at: Long, own: Boolean): Long
  /** Also lowers the transaction's time to `at` when that is earlier: a transaction keeps its earliest source's time. */
  fun addSource(txnId: Long, itemId: Long, channel: Channel, txId: String?, at: Long)
  fun setOwn(id: Long, own: Boolean, ownSet: Boolean, pairId: Long?)
  fun setTxIdIfNull(id: Long, txId: String)
}

object Dedup {
  const val MERGE_WINDOW_MS = 10 * 60_000L

  fun match(p: Parsed, channel: Channel, at: Long, candidates: List<Txn>, byTxId: Txn?): Long? {
    if (p.txId != null && byTxId != null) return byTxId.id
    return candidates
      .filter {
        it.direction == p.direction && it.amountMinor == p.amountMinor && it.currency == p.currency && it.account == p.account &&
          abs(at - it.at) <= MERGE_WINDOW_MS && channel !in it.channels &&
          !(p.txId != null && it.txId != null && p.txId != it.txId)
      }
      .minWithOrNull(compareBy<Txn>({ abs(at - it.at) }, { it.id }))
      ?.id
  }
}

object OwnTransfer {
  const val PAIR_WINDOW_MS = 30 * 60_000L
  private val NOT_LETTER = Regex("[^\\p{L} ]")
  private val SPACES = Regex("\\s+")

  fun nameMatches(counterparty: String?, ownerName: String?): Boolean {
    val a = normalize(counterparty)
    return a.isNotBlank() && a == normalize(ownerName)
  }

  private fun normalize(s: String?): String =
    (s ?: "").uppercase(Locale.ROOT).replace(NOT_LETTER, "").replace(SPACES, " ").trim()
}

class Ledger(private val store: LedgerStore, private val ownerName: () -> String?) {
  fun onItem(itemId: Long, text: String, channel: Channel, at: Long): Long? {
    if (store.hasSource(itemId)) return null
    val p = BankParser.parse(text) ?: return null
    val w = Dedup.MERGE_WINDOW_MS
    val hit = Dedup.match(p, channel, at, store.near(p.direction, p.amountMinor, p.currency, at - w, at + w), p.txId?.let(store::byTxId))
    if (hit != null) {
      store.addSource(hit, itemId, channel, p.txId, at)
      p.txId?.let { store.setTxIdIfNull(hit, it) }
      return hit
    }
    val id = store.add(p, at, OwnTransfer.nameMatches(p.counterparty, ownerName()))
    store.addSource(id, itemId, channel, p.txId, at)
    pair(id, p, at)
    return id
  }

  private fun pair(id: Long, p: Parsed, at: Long) {
    val w = OwnTransfer.PAIR_WINDOW_MS
    val opposite = if (p.direction == Direction.IN) Direction.OUT else Direction.IN
    val other = store.near(opposite, p.amountMinor, p.currency, at - w, at + w)
      .filter { it.account != p.account && it.pairId == null && !it.ownSet }
      .minWithOrNull(compareBy<Txn>({ abs(at - it.at) }, { it.id })) ?: return
    val pairId = minOf(id, other.id)
    store.setOwn(id, true, false, pairId)
    store.setOwn(other.id, true, false, pairId)
  }

  fun setOwnTransfer(txnId: Long, own: Boolean) {
    val txn = store.get(txnId) ?: return
    if (own) {
      store.setOwn(txnId, true, true, txn.pairId)
      return
    }
    val sides = txn.pairId?.let(store::paired).orEmpty().map { it.id }.toSet() + txnId
    sides.forEach { store.setOwn(it, false, true, null) }
  }
}
