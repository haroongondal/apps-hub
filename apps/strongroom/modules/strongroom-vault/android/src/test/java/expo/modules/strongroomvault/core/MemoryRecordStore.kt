package expo.modules.strongroomvault.core

/** The reference SyncRecordStore, as MemorySyncStore is in strongroom-core: SqliteRecordStore must behave the same. */
class MemoryRecordStore : SyncRecordStore {
  var headerJson: String? = null
  val records = LinkedHashMap<String, ByteArray>()
  val revs = HashMap<String, Long>()
  val dirty = HashSet<String>()
  var meta = SyncMeta(0, 0)
  val quarantined = ArrayList<SyncRow>()
  val stagedRows = LinkedHashMap<String, SyncRow>()
  var putAllCalls = 0
  var writes = 0

  override fun header() = headerJson

  override fun putHeader(json: String) {
    writes++
    headerJson = json
  }

  override fun all(): Map<String, ByteArray> = LinkedHashMap(records)

  override fun putAll(records: Map<String, ByteArray>) {
    putAllCalls++
    writes++
    this.records.putAll(records)
    dirty += records.keys
  }

  override fun syncRecords() = records.map { (id, sealed) -> SyncRecord(id, sealed, revs[id] ?: 0, id in dirty) }

  override fun syncMeta() = meta

  override fun applyPull(p: PullApplied) {
    writes++
    p.header?.let { headerJson = it.toJson() }
    var held = false
    for (r in p.records) {
      val now = records[r.id]
      if (if (r.seen == null) now != null else now == null || !now.contentEquals(r.seen)) {
        held = true
        continue
      }
      records[r.id] = r.sealed
      revs[r.id] = r.rev
      dirty -= r.id
    }
    meta = SyncMeta(if (held) meta.lastRev else p.lastRev, p.headerRev)
    quarantined += p.quarantine
    for (b in p.rebase) if (b.id in records) revs[b.id] = b.rev
    stagedRows.clear()
  }

  override fun markPushed(items: List<SyncRow>) {
    writes++
    for (i in items) {
      val now = records[i.id] ?: continue
      revs[i.id] = i.rev
      if (now.contentEquals(i.sealed)) dirty -= i.id
    }
  }

  override fun quarantine() = quarantined.map { it.id to it.rev }

  override fun stage(rows: List<SyncRow>, pendingRev: Long) {
    for (r in rows) stagedRows[r.id] = r
    meta = meta.copy(pendingRev = maxOf(meta.pendingRev, pendingRev))
  }

  override fun staged() = stagedRows.values.toList()

  fun state(id: String) = Triple(records[id]?.toList(), revs[id] ?: 0L, id in dirty)
}
