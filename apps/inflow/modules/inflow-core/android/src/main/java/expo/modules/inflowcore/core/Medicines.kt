package expo.modules.inflowcore.core

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeParseException

data class Medicine(
  val id: Long,
  val name: String,
  val dose: String,
  val times: List<LocalTime>,
  val days: Set<DayOfWeek>,
  val startDay: LocalDate,
  val endDay: LocalDate?,
  val active: Boolean = true,
  val createdAt: Long = 0L,
)

data class DoseMark(val medicineId: Long, val dueAt: Long, val status: String, val markedAt: Long)

data class Dose(val medicineId: Long, val dueAt: Long, val windowEnd: Long, val status: String, val markedAt: Long?)

data class Snooze(val medicineId: Long, val dueAt: Long, val count: Int, val at: Long)

data class ReminderState(val lastTick: Long, val snoozes: List<Snooze>)

data class TickPlan(val missed: List<DoseMark>, val notify: List<Dose>, val nextAlarm: Long?, val state: ReminderState)

data class Adherence(val medicineId: Long?, val taken: Int, val skipped: Int, val missed: Int, val percent: Int?, val streak: Int)

data class AdherenceReport(val period: String, val fromDay: LocalDate, val toDay: LocalDate, val all: Adherence, val medicines: List<Adherence>)

interface MedicineStore {
  fun medicines(): List<Medicine>

  fun get(id: Long): Medicine?

  fun insert(m: Medicine): Long

  fun update(m: Medicine)

  fun stop(id: Long)

  fun delete(id: Long)

  fun log(fromMs: Long, toMs: Long): List<DoseMark>

  fun mark(m: DoseMark)

  fun recordMissed(marks: List<DoseMark>)

  fun reminderState(): ReminderState?

  fun setReminderState(s: ReminderState)
}

fun Medicine.toMap(): Map<String, Any?> = mapOf(
  "id" to id, "name" to name, "dose" to dose, "times" to times.map(Medicines::timeText), "days" to days.map { it.value }.sorted(),
  "startDay" to startDay.toString(), "endDay" to endDay?.toString(), "active" to active, "createdAt" to createdAt,
)

fun Dose.toMap(): Map<String, Any?> =
  mapOf("medicineId" to medicineId, "dueAt" to dueAt, "windowEnd" to windowEnd, "status" to status, "markedAt" to markedAt)

fun Adherence.toMap(): Map<String, Any?> =
  mapOf("medicineId" to medicineId, "taken" to taken, "skipped" to skipped, "missed" to missed, "percent" to percent, "streak" to streak)

fun AdherenceReport.toMap(): Map<String, Any?> =
  mapOf("period" to period, "fromDay" to fromDay.toString(), "toDay" to toDay.toString(), "all" to all.toMap(), "medicines" to medicines.map { it.toMap() })

object Medicines {
  const val TAKEN = "taken"
  const val SKIPPED = "skipped"
  const val MISSED = "missed"
  const val PENDING = "pending"
  const val UPCOMING = "upcoming"
  const val WINDOW_MS = 4 * 3_600_000L
  const val SNOOZE_MS = 10 * 60_000L
  const val MAX_SNOOZES = 3
  const val EARLY_MS = 3_600_000L
  const val MAX_TEXT = 80
  const val MAX_TIMES = 12
  const val LOOKBACK_MS = 31 * 86_400_000L
  const val GONE = "That medicine was deleted."
  private const val AHEAD_DAYS = 8L
  private const val STREAK_DAYS = 366L
  private val TIME = Regex("([01]\\d|2[0-3]):([0-5]\\d)")

  fun timeText(t: LocalTime): String = "%02d:%02d".format(t.hour, t.minute)

  fun parseTime(s: String): LocalTime? = TIME.matchEntire(s.trim())?.let { LocalTime.of(it.groupValues[1].toInt(), it.groupValues[2].toInt()) }

  fun timesText(times: List<LocalTime>): String = times.joinToString(",", transform = ::timeText)

  fun daysText(days: Set<DayOfWeek>): String = days.map { it.value }.sorted().joinToString(",")

  fun parseTimes(text: String): List<LocalTime> = text.split(',').mapNotNull(::parseTime)

  fun parseDays(text: String): Set<DayOfWeek> = text.split(',').mapNotNull { it.trim().toIntOrNull()?.takeIf { n -> n in 1..7 }?.let(DayOfWeek::of) }.toSet()

  fun fromMap(map: Map<String, Any?>): Result<Medicine> {
    val name = (map["name"] as? String)?.trim().orEmpty()
    val dose = (map["dose"] as? String)?.trim().orEmpty()
    val times = (map["times"] as? List<*>).orEmpty().map { (it as? String)?.let(::parseTime) }
    val days = (map["days"] as? List<*>).orEmpty().map { (it as? Number)?.toDouble()?.takeIf { n -> n % 1.0 == 0.0 && n in 1.0..7.0 }?.let { n -> DayOfWeek.of(n.toInt()) } }
    val start = day(map["startDay"])
    val end = map["endDay"]?.let(::day)
    val problem = when {
      name.isEmpty() -> "Write the medicine's name."
      name.length > MAX_TEXT -> "Keep the name to $MAX_TEXT characters or fewer."
      dose.isEmpty() -> "Write the dose, for example 1 tablet."
      dose.length > MAX_TEXT -> "Keep the dose to $MAX_TEXT characters or fewer."
      times.isEmpty() -> "Add at least one time of day."
      times.any { it == null } -> "Write times as hours and minutes, like 08:30."
      times.size > MAX_TIMES -> "Add at most $MAX_TIMES times a day."
      times.toSet().size != times.size -> "Each time can be added once."
      days.isEmpty() -> "Pick at least one day of the week."
      days.any { it == null } -> "Pick days from Monday to Sunday."
      start == null -> "Pick a start date."
      map["endDay"] != null && end == null -> "Pick an end date, or leave it empty."
      start != null && end != null && end.isBefore(start) -> "The end date can't be before the start date."
      else -> null
    }
    if (problem != null) return Result.failure(IllegalArgumentException(problem))
    val id = (map["id"] as? Number)?.toLong()?.takeIf { it > 0 } ?: 0L
    return Result.success(Medicine(id, name, dose, times.filterNotNull().sorted(), days.filterNotNull().toSet(), start!!, end))
  }

  private fun day(v: Any?): LocalDate? = (v as? String)?.let { try { LocalDate.parse(it) } catch (e: DateTimeParseException) { null } }

  fun save(store: MedicineStore, map: Map<String, Any?>, now: Long): String? {
    val m = fromMap(map).getOrElse { return it.message }
    if (m.id == 0L) store.insert(m.copy(createdAt = now))
    else if (store.get(m.id) == null) return GONE
    else store.update(m)
    return null
  }

  // A wall-clock time skipped by a clock change fires at the first instant after the gap; one that happens twice fires once, at the earlier offset.
  fun instant(day: LocalDate, time: LocalTime, zone: ZoneId): Long {
    val local = LocalDateTime.of(day, time)
    val offsets = zone.rules.getValidOffsets(local)
    return if (offsets.isEmpty()) zone.rules.getTransition(local).instant.toEpochMilli() else local.atOffset(offsets.first()).toInstant().toEpochMilli()
  }

  fun occurrences(m: Medicine, fromMs: Long, toMs: Long, zone: ZoneId): List<Long> {
    if (!m.active || toMs <= fromMs) return emptyList()
    val first = maxOf(localDay(fromMs, zone).minusDays(1), m.startDay)
    val toDay = localDay(toMs, zone)
    val last = m.endDay?.let { minOf(it, toDay) } ?: toDay
    val out = sortedSetOf<Long>()
    var d = first
    while (!d.isAfter(last)) {
      if (d.dayOfWeek in m.days) for (t in m.times) instant(d, t, zone).let { if (it in fromMs until toMs) out += it }
      d = d.plusDays(1)
    }
    return out.toList()
  }

  fun windowEnd(m: Medicine, dueAt: Long, zone: ZoneId): Long =
    occurrences(m, dueAt + 1, dueAt + WINDOW_MS, zone).firstOrNull() ?: (dueAt + WINDOW_MS)

  fun isScheduled(m: Medicine, dueAt: Long, zone: ZoneId): Boolean = dueAt >= m.createdAt && occurrences(m, dueAt, dueAt + 1, zone).isNotEmpty()

  // A scheduled dose whose window ended at or before lastTick was swept under the schedule of that time, so after an edit past days stay exactly the log.
  fun doses(meds: List<Medicine>, log: List<DoseMark>, fromMs: Long, toMs: Long, lastTick: Long, now: Long, zone: ZoneId): List<Dose> {
    val byId = meds.associateBy { it.id }
    val logged = log.filter { it.dueAt in fromMs until toMs }.associateBy { it.medicineId to it.dueAt }
    val out = logged.values.map { l -> Dose(l.medicineId, l.dueAt, byId[l.medicineId]?.let { windowEnd(it, l.dueAt, zone) } ?: (l.dueAt + WINDOW_MS), l.status, l.markedAt) }.toMutableList()
    for (m in meds) {
      for (due in occurrences(m, maxOf(fromMs, m.createdAt), toMs, zone)) {
        if ((m.id to due) in logged) continue
        val end = windowEnd(m, due, zone)
        if (end <= lastTick) continue
        out += Dose(m.id, due, end, if (end <= now) MISSED else if (due <= now) PENDING else UPCOMING, null)
      }
    }
    return out.sortedWith(compareBy({ it.dueAt }, { it.medicineId }))
  }

  fun dosesBetween(store: MedicineStore, from: LocalDate, to: LocalDate, now: Long, zone: ZoneId): List<Dose> {
    val fromMs = from.atStartOfDay(zone).toInstant().toEpochMilli()
    val toMs = to.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
    return doses(store.medicines(), store.log(fromMs, toMs), fromMs, toMs, store.reminderState()?.lastTick ?: now, now, zone)
  }

  fun tick(store: MedicineStore, now: Long, zone: ZoneId): TickPlan {
    val state = store.reminderState()
    val last = (state?.lastTick ?: now).coerceIn(now - LOOKBACK_MS, now)
    val meds = store.medicines()
    val byId = meds.associateBy { it.id }
    val recent = doses(meds, store.log(last - WINDOW_MS, now + 1), last - WINDOW_MS + 1, now + 1, last, now, zone)
    val missed = recent.filter { it.markedAt == null && it.status == MISSED }.map { DoseMark(it.medicineId, it.dueAt, MISSED, now) }
    store.recordMissed(missed)
    val open = recent.filter { it.status == PENDING }
    val snoozes = state?.snoozes.orEmpty().filter { s ->
      val m = byId[s.medicineId] ?: return@filter false
      isScheduled(m, s.dueAt, zone) && windowEnd(m, s.dueAt, zone) > now && store.log(s.dueAt, s.dueAt + 1).none { it.medicineId == s.medicineId }
    }
    val notify = open.filter { it.dueAt > last }.toMutableList()
    for (s in snoozes) {
      if (s.at <= last || s.at > now || notify.any { it.medicineId == s.medicineId && it.dueAt == s.dueAt }) continue
      val m = byId.getValue(s.medicineId)
      notify += Dose(m.id, s.dueAt, windowEnd(m, s.dueAt, zone), PENDING, null)
    }
    val nextDue = meds.mapNotNull { occurrences(it, now + 1, now + AHEAD_DAYS * 86_400_000L, zone).firstOrNull() }
    val next = (nextDue + open.map { it.windowEnd } + snoozes.map { it.at }.filter { it > now }).minOrNull()
    val newState = ReminderState(now, snoozes)
    store.setReminderState(newState)
    return TickPlan(missed, notify.sortedBy { it.dueAt }, next, newState)
  }

  fun canSnooze(state: ReminderState?, medicineId: Long, dueAt: Long, windowEnd: Long, now: Long): Boolean {
    val used = state?.snoozes?.firstOrNull { it.medicineId == medicineId && it.dueAt == dueAt }?.count ?: 0
    return used < MAX_SNOOZES && now + SNOOZE_MS < windowEnd
  }

  fun snooze(store: MedicineStore, medicineId: Long, dueAt: Long, now: Long, zone: ZoneId): Long? {
    val m = store.get(medicineId) ?: return null
    if (!isScheduled(m, dueAt, zone) || now < dueAt || store.log(dueAt, dueAt + 1).any { it.medicineId == medicineId }) return null
    val state = store.reminderState() ?: ReminderState(now, emptyList())
    if (!canSnooze(state, medicineId, dueAt, windowEnd(m, dueAt, zone), now)) return null
    val used = state.snoozes.firstOrNull { it.medicineId == medicineId && it.dueAt == dueAt }?.count ?: 0
    val at = now + SNOOZE_MS
    store.setReminderState(state.copy(snoozes = state.snoozes.filterNot { it.medicineId == medicineId && it.dueAt == dueAt } + Snooze(medicineId, dueAt, used + 1, at)))
    return at
  }

  fun markFromReminder(store: MedicineStore, medicineId: Long, dueAt: Long, status: String, now: Long, zone: ZoneId): Boolean {
    if (status != TAKEN && status != SKIPPED) return false
    val m = store.get(medicineId) ?: return false
    if (!isScheduled(m, dueAt, zone) || now >= windowEnd(m, dueAt, zone)) return false
    store.mark(DoseMark(medicineId, dueAt, status, now))
    return true
  }

  fun markFromApp(store: MedicineStore, medicineId: Long, dueAt: Long, status: String, now: Long, zone: ZoneId): String? {
    if (status != TAKEN && status != SKIPPED) return "Mark the dose as taken or skipped."
    val m = store.get(medicineId) ?: return GONE
    val logged = store.log(dueAt, dueAt + 1).any { it.medicineId == medicineId }
    if (!logged && !isScheduled(m, dueAt, zone)) return "That dose isn't on this medicine's schedule."
    if (dueAt > now + EARLY_MS) return "You can mark a dose from an hour before it's due."
    store.mark(DoseMark(medicineId, dueAt, status, now))
    return null
  }

  fun adherence(store: MedicineStore, period: String, now: Long, zone: ZoneId): AdherenceReport {
    val today = localDay(now, zone)
    val first = today.minusDays(if (period == "month") 29 else 6)
    val streakFrom = today.minusDays(STREAK_DAYS - 1)
    val fromMs = streakFrom.atStartOfDay(zone).toInstant().toEpochMilli()
    val toMs = today.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
    val all = doses(store.medicines(), store.log(fromMs, toMs), fromMs, toMs, store.reminderState()?.lastTick ?: now, now, zone)
    val periodFrom = first.atStartOfDay(zone).toInstant().toEpochMilli()
    fun summary(id: Long?, list: List<Dose>): Adherence {
      val inPeriod = list.filter { it.dueAt >= periodFrom }
      val taken = inPeriod.count { it.status == TAKEN }
      val skipped = inPeriod.count { it.status == SKIPPED }
      val missed = inPeriod.count { it.status == MISSED }
      val total = taken + skipped + missed
      val percent = if (total == 0) null else Math.round(taken * 100.0 / total).toInt()
      return Adherence(id, taken, skipped, missed, percent, streak(list.groupBy { localDay(it.dueAt, zone) }, today, streakFrom))
    }
    val perMedicine = all.groupBy { it.medicineId }.filter { (_, l) -> l.any { it.dueAt >= periodFrom } }.map { (id, l) -> summary(id, l) }.sortedBy { it.medicineId }
    return AdherenceReport(if (period == "month") "month" else "week", first, today, summary(null, all), perMedicine)
  }

  fun streak(byDay: Map<LocalDate, List<Dose>>, today: LocalDate, earliest: LocalDate): Int {
    var n = 0
    var d = today
    while (!d.isBefore(earliest)) {
      val list = byDay[d].orEmpty()
      when {
        list.isEmpty() -> Unit
        list.any { it.status == SKIPPED || it.status == MISSED } -> return n
        list.all { it.status == TAKEN } -> n++
      }
      d = d.minusDays(1)
    }
    return n
  }

  fun localDay(ms: Long, zone: ZoneId): LocalDate = Instant.ofEpochMilli(ms).atZone(zone).toLocalDate()

  fun stateText(s: ReminderState): String = "${s.lastTick};" + s.snoozes.joinToString(",") { "${it.medicineId}:${it.dueAt}:${it.count}:${it.at}" }

  fun parseState(text: String?): ReminderState? {
    val parts = text?.split(';', limit = 2) ?: return null
    if (parts.size != 2) return null
    val last = parts[0].toLongOrNull() ?: return null
    val snoozes = if (parts[1].isEmpty()) emptyList() else parts[1].split(',').map { e ->
      val f = e.split(':').map { it.toLongOrNull() ?: return null }
      if (f.size != 4) return null
      Snooze(f[0], f[1], f[2].toInt(), f[3])
    }
    return ReminderState(last, snoozes)
  }
}
