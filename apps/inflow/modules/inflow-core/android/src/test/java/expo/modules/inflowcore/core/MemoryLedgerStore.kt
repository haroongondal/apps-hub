package expo.modules.inflowcore.core

class MemoryLedgerStore : LedgerStore {
  val txns = LinkedHashMap<Long, Txn>()
  private val sources = HashMap<Long, Long>()   // itemId -> txnId
  private var nextId = 1L

  override fun near(direction: Direction, amountMinor: Long, currency: String, from: Long, to: Long) =
    txns.values.filter { it.direction == direction && it.amountMinor == amountMinor && it.currency == currency && it.at in from..to }

  override fun byTxId(txId: String) = txns.values.firstOrNull { it.txId == txId }

  override fun get(id: Long) = txns[id]

  override fun paired(pairId: Long) = txns.values.filter { it.pairId == pairId }

  override fun hasSource(itemId: Long) = itemId in sources

  override fun add(p: Parsed, at: Long, own: Boolean): Long {
    val id = nextId++
    txns[id] = Txn(id, p.direction, p.amountMinor, p.currency, p.account, p.counterparty, p.txId, at, own, false, null, emptySet())
    return id
  }

  override fun addSource(txnId: Long, itemId: Long, channel: Channel, txId: String?, at: Long) {
    sources[itemId] = txnId
    val t = txns.getValue(txnId)
    txns[txnId] = t.copy(channels = t.channels + channel, at = minOf(t.at, at))
  }

  override fun setOwn(id: Long, own: Boolean, ownSet: Boolean, pairId: Long?) {
    txns[id] = txns.getValue(id).copy(own = own, ownSet = ownSet, pairId = pairId)
  }

  override fun setTxIdIfNull(id: Long, txId: String) {
    val t = txns.getValue(id)
    if (t.txId == null) txns[id] = t.copy(txId = txId)
  }

  override fun addChannel(itemId: Long, channel: Channel) {
    val id = sources[itemId] ?: return
    txns[id] = txns.getValue(id).let { it.copy(channels = it.channels + channel) }
  }

  override fun accounts() = txns.values.map { it.account }.distinct()

  override fun setCounterpartyIfNull(id: Long, counterparty: String) {
    val t = txns.getValue(id)
    if (t.counterparty == null) txns[id] = t.copy(counterparty = counterparty)
  }

  override fun undecided() = txns.values.filter { !it.ownSet && it.pairId == null }
}
