package expo.modules.inflowcore.core

import java.util.Locale
import kotlin.math.abs

enum class Channel { SMS, SMS_NOTIFICATION, NOTIFICATION, EMAIL_NOTIFICATION, EMAIL }

data class Txn(
  val id: Long, val direction: Direction, val amountMinor: Long, val currency: String, val account: String,
  val counterparty: String?, val txId: String?, val at: Long,
  val own: Boolean, val ownSet: Boolean,   // ownSet = the owner chose `own` by hand; automation never changes it again
  val pairId: Long?, val channels: Set<Channel>,
  val category: String? = null, val label: String? = null, val byAi: Boolean = false,   // set from an AI result; the numbers above never come from it for a pattern txn
  val categorySet: Boolean = false,   // the owner chose `category`; no AI path changes it again
)

interface LedgerStore {
  fun near(direction: Direction, amountMinor: Long, currency: String, from: Long, to: Long): List<Txn>
  fun byTxId(txId: String): Txn?
  fun get(id: Long): Txn?
  /** Every transaction carrying this pairId, so unlinking reaches the partner whichever side the owner tapped. */
  fun paired(pairId: Long): List<Txn>
  /** The transaction this item is a source of, if any. */
  fun txnOfItem(itemId: Long): Long?
  fun add(p: Parsed, at: Long, own: Boolean, byAi: Boolean = false): Long
  /** Also lowers the transaction's time to `at` when that is earlier: a transaction keeps its earliest source's time. */
  fun addSource(txnId: Long, itemId: Long, channel: Channel, txId: String?, at: Long)
  fun setOwn(id: Long, own: Boolean, ownSet: Boolean, pairId: Long?)
  fun setTxIdIfNull(id: Long, txId: String)
  /** Records `channel` on the transaction sourced by this item, without a new source row (item_id is unique). */
  fun addChannel(itemId: Long, channel: Channel)
  /** Transactions the owner has not decided on and that are not paired: the ones the owner's name may re-label. */
  fun undecided(): List<Txn>
  /** Every distinct account string of known transactions, for Accounts.resolve. */
  fun accounts(): List<String>
  fun setCounterpartyIfNull(id: Long, counterparty: String)
  /** A null label keeps the label already there. A category the owner set stays; the label still updates. */
  fun setAiDetails(id: Long, category: String, label: String?)
  /** The owner's choice (categorySet = true); null clears both, so the AI fills the category again. */
  fun setCategory(id: Long, category: String?)
  /** Transactions with no category, not owner-set and tried fewer than 3 times, newest first. */
  fun uncategorized(limit: Int): List<Txn>
  /** The categoriser sent these and did not categorise them: one more try each. */
  fun categoryTried(ids: List<Long>)
  fun sourceCount(txnId: Long): Int
  /** Removes the transaction and its source rows. */
  fun deleteTxn(id: Long)
  /** A pattern source confirmed an AI transaction: it stops being "by AI". */
  fun clearByAi(id: Long)
  /** The owner's own clean name, written as given (null clears). */
  fun setOwnerLabel(id: Long, label: String?)
  /** Remembers this transaction's source items as deleted by the owner, so neither the backfill nor a late AI result makes the transaction again. Call before deleteTxn. */
  fun blockSources(txnId: Long)
  fun sourceBlocked(itemId: Long): Boolean
  /** Amounts (minor units) of the owner's own-money-out transactions in this category and currency with at >= from, leaving `excludeId` out. */
  fun outHistory(category: String, currency: String, from: Long, excludeId: Long): List<Long>
  /** Every distinct counterparty and clean name of the other transactions: the names already seen. */
  fun knownCounterparties(excludeId: Long): Set<String>
}

const val OTHER_ACCOUNT = "Other account"

object Dedup {
  const val MERGE_WINDOW_MS = 10 * 60_000L
  const val COMPLETE_WINDOW_MS = 2 * 60_000L

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

  /** R38: equal after normalising, or owner name followed by exactly one bank tag token. */
  val BANK_TAGS = setOf("NAYAPAY", "SADAPAY", "JAZZCASH", "EASYPAISA", "UPAISA", "TMB", "MMBL", "BAF", "BAFL")
  private val BIC = Regex("^[A-Z]{4,}PK[A-Z0-9]{2,}$")

  fun nameMatches(counterparty: String?, ownerName: String?): Boolean {
    val a = normalize(counterparty)
    val owner = normalize(ownerName)
    if (a.isBlank() || owner.isBlank()) return false
    if (a == owner) return true
    if (!a.startsWith("$owner ")) return false
    val tag = a.removePrefix("$owner ")
    return ' ' !in tag && (tag in BANK_TAGS || BIC.matches(counterparty!!.trim().substringAfterLast(' ').uppercase(Locale.ROOT)))
  }

  private fun normalize(s: String?): String =
    (s ?: "").uppercase(Locale.ROOT).replace(NOT_LETTER, "").replace(SPACES, " ").trim()
}

/** `onNewTxn(txnId, itemId)` runs once for each transaction a message made, never for one that only gained a source. It must not throw. */
class Ledger(
  private val store: LedgerStore, private val ownerName: () -> String?,
  private val onNewTxn: (txnId: Long, itemId: Long) -> Unit = { _, _ -> },
) {
  fun onItem(itemId: Long, text: String, channel: Channel, at: Long): Long? {
    if (store.sourceBlocked(itemId)) return null
    val p = Accounts.resolve(BankParser.parse(text) ?: return null, store.accounts())
    // An AI-only transaction on this item would block the pattern: the bank's numbers replace it (unless the owner decided on it).
    var replaced: Txn? = null   // its category, label and own mark carry over to the transaction that takes its place
    store.txnOfItem(itemId)?.let { existing ->
      val t = store.get(existing)
      if (t == null || !t.byAi || t.ownSet || store.sourceCount(existing) != 1) return null
      replaced = t
      store.deleteTxn(existing)
    }
    val w = Dedup.MERGE_WINDOW_MS
    val near = store.near(p.direction, p.amountMinor, p.currency, at - w, at + w)
    val hit = Dedup.match(p, channel, at, near, p.txId?.let(store::byTxId)) ?: completes(p, at, near)
    val id = if (hit != null) {
      store.addSource(hit, itemId, channel, p.txId, at)
      if (store.get(hit)?.byAi == true) store.clearByAi(hit)
      p.txId?.let { store.setTxIdIfNull(hit, it) }
      p.counterparty?.let { store.setCounterpartyIfNull(hit, it) }
      // A name that arrives by merging can make the transaction an own transfer, as it would have when the name came first.
      store.get(hit)?.let { t ->
        if (!t.own && !t.ownSet && t.pairId == null && OwnTransfer.nameMatches(t.counterparty, ownerName())) store.setOwn(hit, true, false, null)
      }
      hit
    } else {
      val added = store.add(p, at, OwnTransfer.nameMatches(p.counterparty, ownerName()))
      store.addSource(added, itemId, channel, p.txId, at)
      pair(added, p, at)
      if (replaced == null) runCatching { onNewTxn(added, itemId) }   // a replaced AI transaction was already checked
      added
    }
    replaced?.let { r ->
      val target = store.get(id) ?: return id
      if (r.category != null) {
        if (target.category == null) store.setAiDetails(id, r.category, r.label)
        if (r.categorySet) store.setCategory(id, r.category)   // the owner's choice wins over a category the target already has
      }
      if (r.own && !target.own && !target.ownSet) store.setOwn(id, true, false, target.pairId)
    }
    return id
  }

  // Alfalah texts one transfer twice on one channel: nameless "Debited from", then "sent to <name> ... Tx ID"; Dedup keeps same-channel texts apart on purpose.
  // shortcut: a genuine nameless debit within 2 minutes of a named one (same amount, account) merges too; tighten if that shows up.
  private fun completes(p: Parsed, at: Long, candidates: List<Txn>): Long? {
    val bare = p.counterparty == null && p.txId == null
    return candidates
      .filter {
        val itBare = it.counterparty == null && it.txId == null
        it.direction == p.direction && it.amountMinor == p.amountMinor && it.currency == p.currency && it.account == p.account &&
          abs(at - it.at) <= Dedup.COMPLETE_WINDOW_MS && bare != itBare && (itBare || store.sourceCount(it.id) == 1) &&
          !(p.txId != null && it.txId != null && p.txId != it.txId)
      }
      .minWithOrNull(compareBy<Txn>({ abs(at - it.at) }, { it.id }))
      ?.id
  }

  // Only pattern transactions pair: an AI-only one is a model's reading of a message, never proof that money moved between accounts.
  private fun pair(id: Long, p: Parsed, at: Long) {
    val w = OwnTransfer.PAIR_WINDOW_MS
    val opposite = if (p.direction == Direction.IN) Direction.OUT else Direction.IN
    val other = store.near(opposite, p.amountMinor, p.currency, at - w, at + w)
      .filter { it.account != p.account && it.pairId == null && !it.ownSet && !it.byAi }
      .minWithOrNull(compareBy<Txn>({ abs(at - it.at) }, { it.id })) ?: return
    val pairId = minOf(id, other.id)
    store.setOwn(id, true, false, pairId)
    store.setOwn(other.id, true, false, pairId)
  }

  /** The owner's name changed from `oldName`: only a transaction whose name match changed is re-labelled, so an AI own mark the name never decided stays. Paired and hand-set ones keep their answer. */
  fun ownerNameChanged(oldName: String?) {
    val name = ownerName()
    for (t in store.undecided()) {
      val own = OwnTransfer.nameMatches(t.counterparty, name)
      if (own != OwnTransfer.nameMatches(t.counterparty, oldName) && own != t.own) store.setOwn(t.id, own, false, null)
    }
  }

  /**
   * R28. An item that already made a transaction only gives it a category and a clean name: pattern numbers stand.
   * Otherwise the AI's transaction goes through Dedup like a pattern source, flagged byAi. It never un-owns a transaction, never
   * touches one the owner decided, and never pairs (a message cannot pair itself with real money by asking).
   */
  fun onAi(itemId: Long, money: AiMoney, channel: Channel, at: Long): Long? {
    if (store.sourceBlocked(itemId)) return null
    val existing = store.txnOfItem(itemId)
    if (existing != null) {
      details(existing, money)
      return existing
    }
    // The prompt lists the known accounts; an account the model made up must not become a new one.
    val known = store.accounts()
    val account = known.firstOrNull { it.equals(money.account, ignoreCase = true) } ?: OTHER_ACCOUNT
    val p = Parsed(money.direction, money.amountMinor, money.currency, account, money.counterparty, null)
    val w = Dedup.MERGE_WINDOW_MS
    val hit = Dedup.match(p, channel, at, store.near(p.direction, p.amountMinor, p.currency, at - w, at + w), null)
    if (hit != null) {
      store.addSource(hit, itemId, channel, null, at)
      money.counterparty?.let { store.setCounterpartyIfNull(hit, it) }
      details(hit, money)
      return hit
    }
    val id = store.add(p, at, money.own || OwnTransfer.nameMatches(money.counterparty, ownerName()), byAi = true)
    store.addSource(id, itemId, channel, null, at)
    store.setAiDetails(id, money.category, money.counterparty)
    runCatching { onNewTxn(id, itemId) }
    return id
  }

  private fun details(txnId: Long, money: AiMoney) {
    store.setAiDetails(txnId, money.category, money.counterparty)
    val t = store.get(txnId) ?: return
    if (money.own && !t.own && !t.ownSet) store.setOwn(txnId, true, false, t.pairId)
  }

  fun addChannel(itemId: Long, channel: Channel) = store.addChannel(itemId, channel)

  /** The owner's edit of a transaction's clean name. A later AI reading of another source may still change it. */
  fun editLabel(txnId: Long, label: String?): Boolean {
    if (store.get(txnId) == null) return false
    store.setOwnerLabel(txnId, label)
    return true
  }

  /**
   * The owner deleted a transaction. Its sources are blocked first (no backfill or AI result brings it back). The other side of an
   * own-transfer pair stays an own transfer but is unpaired and counts as hand-decided, so a name change cannot flip it.
   */
  fun deleteByOwner(txnId: Long): Boolean {
    val txn = store.get(txnId) ?: return false
    txn.pairId?.let(store::paired)?.filter { it.id != txnId }?.forEach { store.setOwn(it.id, it.own, true, null) }
    store.blockSources(txnId)
    store.deleteTxn(txnId)
    return true
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
