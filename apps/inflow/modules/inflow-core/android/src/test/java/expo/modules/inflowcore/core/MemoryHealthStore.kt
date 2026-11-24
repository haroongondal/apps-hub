package expo.modules.inflowcore.core

import java.util.TreeMap

class MemoryHealthStore : HealthStore {
  val rows = TreeMap<String, HealthDay>()
  val updatedAt = mutableMapOf<String, Long>()

  override fun replaceDays(first: String, last: String, rows: List<HealthDay>, keepFrom: String, now: Long) {
    this.rows.keys.removeAll { it in first..last }
    rows.forEach { this.rows[it.day] = it; updatedAt[it.day] = now }
    this.rows.keys.removeAll { it < keepFrom }
  }

  override fun days(from: String, to: String) = rows.subMap(from, true, to, true).values.toList()
}
