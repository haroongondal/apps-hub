package expo.modules.inflowcore.core

class MemoryReportStore : ReportStore {
  class Stored(var row: ReportRow, var json: String?)

  val stored = mutableListOf<Stored>()
  val txnList = mutableListOf<Txn>()
  private var nextId = 1L

  val rows get() = stored.map { it.row }

  override fun row(p: Period) = stored.firstOrNull { it.row.kind == p.kind && it.row.periodStart == p.start && it.row.partial == p.partial }?.row

  override fun save(p: Period, status: String, message: String?, tries: Int, headline: String?, json: String?, now: Long): Long {
    val existing = stored.firstOrNull { it.row.kind == p.kind && it.row.periodStart == p.start && it.row.partial == p.partial }
    val id = existing?.row?.id ?: nextId++
    val row = ReportRow(id, p.kind, p.start, p.end, p.partial, now, status, message, tries, headline)
    if (existing != null) { existing.row = row; existing.json = json } else stored += Stored(row, json)
    return id
  }

  override fun previousJson(kind: ReportKind, before: Long) =
    stored.filter { it.row.kind == kind && !it.row.partial && it.row.status == "ready" && it.json != null && it.row.periodStart < before }
      .maxByOrNull { it.row.periodStart }?.json

  override fun txns(from: Long, to: Long) = txnList.filter { it.at >= from && it.at < to }.sortedWith(compareBy({ it.at }, { it.id }))

  override fun prune() {
    for ((kind, keep) in listOf(ReportKind.WEEKLY to 8, ReportKind.MONTHLY to 4)) {
      val drop = stored.filter { it.row.kind == kind && !it.row.partial }.sortedByDescending { it.row.periodStart }.drop(keep)
      stored.removeAll(drop.toSet())
    }
  }

  override fun deletePartial(kind: ReportKind) {
    stored.removeAll { it.row.kind == kind && it.row.partial }
  }
}
