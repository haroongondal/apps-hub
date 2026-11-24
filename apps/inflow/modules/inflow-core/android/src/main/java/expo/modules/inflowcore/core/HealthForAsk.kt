package expo.modules.inflowcore.core

import java.time.Instant
import java.time.ZoneId

// R10: the private constructor makes context() the only way health text can reach Ask.answerUser. Aggregates only: no journal, no medicine names or doses.
class HealthForAsk private constructor(val text: String) {
  companion object {
    const val META = "healthInAsk"
    const val MAX_DAYS = 31L

    fun on(meta: String?): Boolean = meta == "1"

    fun context(settingOn: Boolean, health: HealthStore, meds: MedicineStore, fromMs: Long, toMs: Long, now: Long, zone: ZoneId): HealthForAsk? {
      if (!settingOn) return null
      val to = Instant.ofEpochMilli(toMs).atZone(zone).toLocalDate()
      val from = maxOf(Instant.ofEpochMilli(fromMs).atZone(zone).toLocalDate(), to.minusDays(MAX_DAYS - 1))
      val days = health.days(from.toString(), to.toString()).map { d ->
        listOfNotNull(
          d.steps?.let { "steps $it" }, d.sleepMinutes?.let { "sleep $it min" },
          d.hrAvg?.let { "heart rate average $it" }, d.hrLow?.let { "heart rate lowest $it" },
        ).joinToString(", ", "${d.day}: ")
      }
      val counts = DoctorPayload.counts(Medicines.dosesBetween(meds, from, to, now, zone)).toSortedMap().values
        .mapIndexed { i, c -> "medicine ${i + 1}: taken ${c.taken}, skipped ${c.skipped}, missed ${c.missed}" }
      val body = (days + counts).ifEmpty { listOf("No health data saved for these days.") }
      return HealthForAsk("Health from $from to $to (daily numbers the owner chose to share; medicine names left out):\n" + body.joinToString("\n"))
    }
  }
}
