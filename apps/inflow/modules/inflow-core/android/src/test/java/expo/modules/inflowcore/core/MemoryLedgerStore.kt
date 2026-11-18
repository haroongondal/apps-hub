package expo.modules.inflowcore.core

class MemoryLedgerStore : LedgerStore {
  val txns = LinkedHashMap<Long, Txn>()
  private val sources = HashMap<Long, Long>()   // itemId -> txnId
  private var nextId = 1L
  val tries = HashMap<Long, Int>()   // txnId -> category_tries

  override fun near(direction: Direction, amountMinor: Long, currency: String, from: Long, to: Long) =
    txns.values.filter { it.direction == direction && it.amountMinor == amountMinor && it.currency == currency && it.at in from..to }

  override fun byTxId(txId: String) = txns.values.firstOrNull { it.txId == txId }

  override fun get(id: Long) = txns[id]

  override fun paired(pairId: Long) = txns.values.filter { it.pairId == pairId }

  override fun txnOfItem(itemId: Long) = sources[itemId]

  override fun add(p: Parsed, at: Long, own: Boolean, byAi: Boolean): Long {
    val id = nextId++
    txns[id] = Txn(id, p.direction, p.amountMinor, p.currency, p.account, p.counterparty, p.txId, at, own, false, null, emptySet(), byAi = byAi)
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

  override fun setAiDetails(id: Long, category: String, label: String?) {
    txns[id] = txns.getValue(id).let { it.copy(category = if (it.categorySet) it.category else category, label = label ?: it.label) }
  }

  override fun setCategory(id: Long, category: String?) {
    txns[id] = txns.getValue(id).copy(category = category, categorySet = category != null)
    if (category == null) tries.remove(id)
  }

  override fun uncategorized(limit: Int) =
    txns.values.filter { it.category == null && !it.categorySet && (tries[it.id] ?: 0) < 3 }.sortedWith(compareByDescending<Txn> { it.at }.thenByDescending { it.id }).take(limit)

  override fun categoryTried(ids: List<Long>) {
    ids.forEach { tries[it] = (tries[it] ?: 0) + 1 }
  }

  override fun sourceCount(txnId: Long) = sources.values.count { it == txnId }

  override fun deleteTxn(id: Long) {
    txns.remove(id)
    sources.values.removeAll { it == id }
  }

  val blocked = mutableSetOf<Long>()   // items whose transaction the owner deleted

  override fun setOwnerLabel(id: Long, label: String?) {
    txns[id] = txns.getValue(id).copy(label = label)
  }

  override fun blockSources(txnId: Long) {
    blocked += sources.filterValues { it == txnId }.keys
  }

  override fun sourceBlocked(itemId: Long) = itemId in blocked

  override fun outHistory(category: String, currency: String, from: Long, excludeId: Long) =
    txns.values.filter { it.id != excludeId && !it.own && it.direction == Direction.OUT && it.category == category && it.currency == currency && it.at >= from }.map { it.amountMinor }

  override fun knownCounterparties(excludeId: Long) =
    txns.values.filter { it.id != excludeId }.flatMap { listOfNotNull(it.counterparty, it.label) }.toSet()

  override fun clearByAi(id: Long) {
    txns[id] = txns.getValue(id).copy(byAi = false)
  }
}
