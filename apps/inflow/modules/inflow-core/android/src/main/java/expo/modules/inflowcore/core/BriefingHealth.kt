package expo.modules.inflowcore.core

import java.time.LocalDate
import java.time.ZoneId

// The briefing's only way into health data: a dose time (no name, no dose) and steps. Never sleep, heart rate, the journal or the dose log beyond "already marked".
class StoreBriefingHealth(private val health: HealthStore, private val meds: MedicineStore) : BriefingHealth {
  override fun nextDoseAt(now: Long, zone: ZoneId): Long? {
    val to = now + DAY_MS
    val marked = meds.log(now, to).map { it.medicineId to it.dueAt }.toSet()
    return meds.medicines().flatMap { m -> Medicines.occurrences(m, now, to, zone).filter { (m.id to it) !in marked } }.minOrNull()
  }

  override fun steps(day: LocalDate): Long? = health.days(day.toString(), day.toString()).firstOrNull()?.steps

  private companion object {
    const val DAY_MS = 86_400_000L
  }
}
