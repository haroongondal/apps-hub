package expo.modules.inflowcore.core

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MedicinesTest {
  private val karachi = ZoneId.of("Asia/Karachi")
  private val london = ZoneId.of("Europe/London")
  private val newYork = ZoneId.of("America/New_York")
  private val hour = 3_600_000L
  private val min = 60_000L

  private fun at(s: String, zone: ZoneId = karachi) = LocalDateTime.parse(s).atZone(zone).toInstant().toEpochMilli()
  private fun utc(s: String) = Instant.parse(s).toEpochMilli()
  private fun d(s: String) = LocalDate.parse(s)
  private fun med(
    times: List<String> = listOf("08:00"),
    days: Set<DayOfWeek> = DayOfWeek.values().toSet(),
    start: String = "2026-03-01",
    end: String? = null,
    createdAt: Long = 0L,
    id: Long = 1L,
  ) = Medicine(id, "Vitamin D", "1 tablet", times.map(LocalTime::parse), days, d(start), end?.let(::d), true, createdAt)

  private fun store(vararg meds: Medicine) = MemoryMedicineStore().apply { meds.forEach { this.meds[it.id] = it } }

  @Test fun karachiDosesAreLocalWallTime() {
    val m = med(times = listOf("08:00", "20:00"))
    assertEquals(listOf(utc("2026-03-10T03:00:00Z"), utc("2026-03-10T15:00:00Z")), Medicines.occurrences(m, at("2026-03-10T00:00"), at("2026-03-11T00:00"), karachi))
  }

  @Test fun londonSpringForwardFiresAtTheFirstInstantAfterTheGap() {
    val m = med(times = listOf("01:30", "08:00"))
    val day = Medicines.occurrences(m, utc("2026-03-29T00:00:00Z"), utc("2026-03-30T00:00:00Z"), london)
    assertEquals(listOf(utc("2026-03-29T01:00:00Z"), utc("2026-03-29T07:00:00Z")), day)
  }

  @Test fun londonFallBackFiresOnceAtTheEarlierOffset() {
    val m = med(times = listOf("01:30"))
    val day = Medicines.occurrences(m, utc("2026-10-24T23:00:00Z"), utc("2026-10-26T00:00:00Z"), london)
    assertEquals(listOf(utc("2026-10-25T00:30:00Z")), day)
  }

  @Test fun newYorkGapAndOverlap() {
    assertEquals(utc("2026-03-08T07:00:00Z"), Medicines.instant(d("2026-03-08"), LocalTime.of(2, 30), newYork))
    assertEquals(utc("2026-11-01T05:30:00Z"), Medicines.instant(d("2026-11-01"), LocalTime.of(1, 30), newYork))
    val m = med(times = listOf("01:30"), start = "2026-10-31")
    assertEquals(1, Medicines.occurrences(m, utc("2026-11-01T04:00:00Z"), utc("2026-11-01T12:00:00Z"), newYork).size)
  }

  @Test fun twoTimesInsideOneGapFireOnce() {
    val m = med(times = listOf("01:15", "01:45"))
    assertEquals(listOf(utc("2026-03-29T01:00:00Z")), Medicines.occurrences(m, utc("2026-03-29T00:00:00Z"), utc("2026-03-29T12:00:00Z"), london))
  }

  @Test fun onlyThePickedWeekdays() {
    val m = med(days = setOf(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY))
    val week = Medicines.occurrences(m, at("2026-03-09T00:00"), at("2026-03-16T00:00"), karachi)
    assertEquals(listOf("2026-03-09", "2026-03-11", "2026-03-13"), week.map { Medicines.localDay(it, karachi).toString() })
  }

  @Test fun startAndEndDaysAreInclusive() {
    val m = med(start = "2026-03-05", end = "2026-03-07")
    val all = Medicines.occurrences(m, at("2026-03-01T00:00"), at("2026-03-11T00:00"), karachi)
    assertEquals(listOf("2026-03-05", "2026-03-06", "2026-03-07"), all.map { Medicines.localDay(it, karachi).toString() })
  }

  @Test fun aStoppedMedicineHasNoDoses() {
    assertTrue(Medicines.occurrences(med().copy(active = false), at("2026-03-01T00:00"), at("2026-03-11T00:00"), karachi).isEmpty())
  }

  @Test fun validationSaysWhatIsWrong() {
    val ok = mapOf<String, Any?>("name" to " Vitamin D ", "dose" to "1 tablet", "times" to listOf("20:00", "08:00"), "days" to listOf(1.0, 3.0), "startDay" to "2026-03-01", "endDay" to null)
    val m = Medicines.fromMap(ok).getOrThrow()
    assertEquals("Vitamin D", m.name)
    assertEquals(listOf(LocalTime.of(8, 0), LocalTime.of(20, 0)), m.times)
    assertEquals(setOf(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY), m.days)
    assertEquals(0L, m.id)
    fun problem(change: Pair<String, Any?>) = Medicines.fromMap(ok + change).exceptionOrNull()?.message
    assertEquals("Pick at least one day of the week.", problem("days" to emptyList<Any>()))
    assertEquals("Pick days from Monday to Sunday.", problem("days" to listOf(8.0)))
    assertEquals("Write the medicine's name.", problem("name" to "  "))
    assertEquals("Write the dose, for example 1 tablet.", problem("dose" to ""))
    assertEquals("Write times as hours and minutes, like 08:30.", problem("times" to listOf("8am")))
    assertEquals("Write times as hours and minutes, like 08:30.", problem("times" to listOf("24:00")))
    assertEquals("Each time can be added once.", problem("times" to listOf("08:00", "08:00")))
    assertEquals("Add at least one time of day.", problem("times" to emptyList<Any>()))
    assertEquals("The end date can't be before the start date.", problem("endDay" to "2026-02-28"))
    assertEquals("Pick an end date, or leave it empty.", problem("endDay" to "soon"))
    assertEquals("Pick a start date.", problem("startDay" to null))
  }

  @Test fun saveCreatesThenUpdatesKeepingCreatedAt() {
    val s = MemoryMedicineStore()
    val input = mapOf<String, Any?>("name" to "A", "dose" to "1", "times" to listOf("08:00"), "days" to listOf(1.0), "startDay" to "2026-03-01")
    assertNull(Medicines.save(s, input, 500L))
    assertEquals(500L, s.get(1)!!.createdAt)
    assertNull(Medicines.save(s, input + ("id" to 1.0) + ("name" to "B"), 900L))
    assertEquals("B", s.get(1)!!.name)
    assertEquals(500L, s.get(1)!!.createdAt)
    assertEquals(Medicines.GONE, Medicines.save(s, input + ("id" to 7.0), 900L))
  }

  @Test fun windowIsFourHoursOrTheNextDose() {
    val m = med(times = listOf("08:00", "10:00", "20:00"))
    assertEquals(at("2026-03-10T10:00"), Medicines.windowEnd(m, at("2026-03-10T08:00"), karachi))
    assertEquals(at("2026-03-10T14:00"), Medicines.windowEnd(m, at("2026-03-10T10:00"), karachi))
  }

  @Test fun theReminderCanMarkUntilJustBeforeTheWindowEnds() {
    val s = store(med())
    val due = at("2026-03-10T08:00")
    assertTrue(Medicines.markFromReminder(s, 1, due, Medicines.TAKEN, due + 4 * hour - 1, karachi))
    assertTrue(Medicines.markFromReminder(s, 1, due, Medicines.SKIPPED, due + 4 * hour - 1, karachi))
    assertEquals(Medicines.SKIPPED, s.marks[1L to due]!!.status)
    val next = at("2026-03-11T08:00")
    assertFalse(Medicines.markFromReminder(s, 1, next, Medicines.TAKEN, next + 4 * hour, karachi))
    assertFalse(Medicines.markFromReminder(s, 1, due + min, Medicines.TAKEN, due + 2 * min, karachi))
  }

  @Test fun theSweepRecordsAMissAtExactlyTheWindowEndAndIsIdempotent() {
    val s = store(med(times = listOf("08:00", "20:00")))
    val first = Medicines.tick(s, at("2026-03-10T07:00"), karachi)
    assertTrue(first.missed.isEmpty() && first.notify.isEmpty())
    assertEquals(at("2026-03-10T08:00"), first.nextAlarm)
    val due = Medicines.tick(s, at("2026-03-10T08:00"), karachi)
    assertEquals(listOf(at("2026-03-10T08:00")), due.notify.map { it.dueAt })
    assertEquals(at("2026-03-10T12:00"), due.nextAlarm)
    assertTrue(Medicines.tick(s, at("2026-03-10T12:00") - 1, karachi).missed.isEmpty())
    val end = Medicines.tick(s, at("2026-03-10T12:00"), karachi)
    assertEquals(listOf(DoseMark(1, at("2026-03-10T08:00"), Medicines.MISSED, at("2026-03-10T12:00"))), end.missed)
    assertTrue(end.notify.isEmpty())
    assertEquals(at("2026-03-10T20:00"), end.nextAlarm)
    assertTrue(Medicines.tick(s, at("2026-03-10T12:00"), karachi).missed.isEmpty())
    assertTrue(Medicines.tick(s, at("2026-03-10T13:00"), karachi).missed.isEmpty())
    assertEquals(1, s.marks.size)
  }

  @Test fun theFirstRunBackDatesNothing() {
    val s = store(med(times = listOf("08:00", "20:00")))
    val plan = Medicines.tick(s, at("2026-03-10T13:00"), karachi)
    assertTrue(plan.missed.isEmpty() && plan.notify.isEmpty())
    assertTrue(Medicines.dosesBetween(s, d("2026-03-10"), d("2026-03-10"), at("2026-03-10T13:00"), karachi).none { it.dueAt == at("2026-03-10T08:00") })
  }

  @Test fun theSweepNeverOverwritesAMark() {
    val s = store(med())
    Medicines.tick(s, at("2026-03-10T07:00"), karachi)
    s.mark(DoseMark(1, at("2026-03-10T08:00"), Medicines.TAKEN, at("2026-03-10T08:05")))
    assertTrue(Medicines.tick(s, at("2026-03-10T13:00"), karachi).missed.isEmpty())
    assertEquals(Medicines.TAKEN, s.marks[1L to at("2026-03-10T08:00")]!!.status)
  }

  @Test fun aDoseBeforeTheMedicineWasAddedIsNeverMissed() {
    val s = store(med(createdAt = at("2026-03-10T09:00")))
    Medicines.tick(s, at("2026-03-10T07:00"), karachi)
    assertTrue(Medicines.tick(s, at("2026-03-10T13:00"), karachi).missed.isEmpty())
  }

  @Test fun snoozeIsTenMinutesAtMostThreeTimes() {
    val s = store(med())
    val due = at("2026-03-10T08:00")
    Medicines.tick(s, due - hour, karachi)
    Medicines.tick(s, due, karachi)
    assertEquals(due + 11 * min, Medicines.snooze(s, 1, due, due + min, karachi))
    val back = Medicines.tick(s, due + 11 * min, karachi)
    assertEquals(listOf(due), back.notify.map { it.dueAt })
    assertEquals(due + 22 * min, Medicines.snooze(s, 1, due, due + 12 * min, karachi))
    assertEquals(due + 33 * min, Medicines.snooze(s, 1, due, due + 23 * min, karachi))
    assertFalse(Medicines.canSnooze(s.state, 1, due, due + 4 * hour, due + 24 * min))
    assertNull(Medicines.snooze(s, 1, due, due + 24 * min, karachi))
    assertEquals(3, s.state!!.snoozes.single().count)
  }

  @Test fun snoozeNeverPassesTheWindowEnd() {
    val s = store(med())
    val due = at("2026-03-10T08:00")
    Medicines.tick(s, due, karachi)
    assertNull(Medicines.snooze(s, 1, due, due + 4 * hour - 10 * min, karachi))
    assertEquals(due + 4 * hour - min, Medicines.snooze(s, 1, due, due + 4 * hour - 11 * min, karachi))
  }

  @Test fun aMarkedDoseCannotBeSnoozedAndDropsItsSnooze() {
    val s = store(med())
    val due = at("2026-03-10T08:00")
    Medicines.tick(s, due, karachi)
    Medicines.snooze(s, 1, due, due + min, karachi)
    Medicines.markFromReminder(s, 1, due, Medicines.TAKEN, due + 2 * min, karachi)
    assertNull(Medicines.snooze(s, 1, due, due + 3 * min, karachi))
    val plan = Medicines.tick(s, due + 11 * min, karachi)
    assertTrue(plan.notify.isEmpty())
    assertTrue(plan.state.snoozes.isEmpty())
  }

  @Test fun theAppCorrectsAMissedDoseAndRecordsWhen() {
    val s = store(med())
    val due = at("2026-03-10T08:00")
    s.mark(DoseMark(1, due, Medicines.MISSED, due + 4 * hour))
    assertNull(Medicines.markFromApp(s, 1, due, Medicines.TAKEN, at("2026-03-12T10:00"), karachi))
    assertEquals(DoseMark(1, due, Medicines.TAKEN, at("2026-03-12T10:00")), s.marks[1L to due])
    assertEquals("Mark the dose as taken or skipped.", Medicines.markFromApp(s, 1, due, Medicines.MISSED, due, karachi))
    assertEquals("That dose isn't on this medicine's schedule.", Medicines.markFromApp(s, 1, due + min, Medicines.TAKEN, due, karachi))
    assertEquals("You can mark a dose from an hour before it's due.", Medicines.markFromApp(s, 1, at("2026-03-11T08:00"), Medicines.TAKEN, at("2026-03-11T06:59"), karachi))
    assertNull(Medicines.markFromApp(s, 1, at("2026-03-11T08:00"), Medicines.TAKEN, at("2026-03-11T07:00"), karachi))
    assertEquals(Medicines.GONE, Medicines.markFromApp(s, 9, due, Medicines.TAKEN, due, karachi))
  }

  @Test fun aMedicineEditedMidHistoryKeepsItsLoggedDueTimes() {
    val s = store(med())
    s.mark(DoseMark(1, at("2026-03-08T08:00"), Medicines.TAKEN, at("2026-03-08T08:10")))
    s.mark(DoseMark(1, at("2026-03-09T08:00"), Medicines.MISSED, at("2026-03-09T12:00")))
    s.state = ReminderState(at("2026-03-10T07:00"), emptyList())
    s.update(med(times = listOf("09:00")))
    val doses = Medicines.dosesBetween(s, d("2026-03-08"), d("2026-03-10"), at("2026-03-10T07:00"), karachi)
    assertEquals(listOf(at("2026-03-08T08:00"), at("2026-03-09T08:00"), at("2026-03-10T09:00")), doses.map { it.dueAt })
    assertEquals(listOf(Medicines.TAKEN, Medicines.MISSED, Medicines.UPCOMING), doses.map { it.status })
    assertNull(Medicines.markFromApp(s, 1, at("2026-03-08T08:00"), Medicines.SKIPPED, at("2026-03-10T07:00"), karachi))
  }

  @Test fun stoppingKeepsHistoryAndDeletingRemovesIt() {
    val s = store(med(), med(id = 2))
    s.mark(DoseMark(1, at("2026-03-09T08:00"), Medicines.TAKEN, 1))
    s.mark(DoseMark(2, at("2026-03-09T08:00"), Medicines.TAKEN, 1))
    s.state = ReminderState(at("2026-03-10T07:00"), emptyList())
    s.stop(1)
    val now = at("2026-03-10T07:00")
    val left = Medicines.dosesBetween(s, d("2026-03-09"), d("2026-03-10"), now, karachi)
    assertEquals(listOf(1L to at("2026-03-09T08:00"), 2L to at("2026-03-09T08:00"), 2L to at("2026-03-10T08:00")), left.map { it.medicineId to it.dueAt })
    s.delete(2)
    assertEquals(listOf(1L), Medicines.dosesBetween(s, d("2026-03-09"), d("2026-03-10"), now, karachi).map { it.medicineId })
    assertNull(Medicines.tick(s, now, karachi).nextAlarm)
  }

  @Test fun dosesBetweenShowsPendingAndUpcoming() {
    val s = store(med(times = listOf("08:00", "20:00")))
    s.state = ReminderState(at("2026-03-10T07:00"), emptyList())
    val doses = Medicines.dosesBetween(s, d("2026-03-10"), d("2026-03-10"), at("2026-03-10T09:00"), karachi)
    assertEquals(listOf(Medicines.PENDING, Medicines.UPCOMING), doses.map { it.status })
    assertEquals(at("2026-03-10T12:00"), doses[0].windowEnd)
    val late = Medicines.dosesBetween(s, d("2026-03-10"), d("2026-03-10"), at("2026-03-10T12:00"), karachi)
    assertEquals(Medicines.MISSED, late[0].status)
  }

  private fun weekOfMarks(s: MemoryMedicineStore) {
    for (day in 4..9) s.mark(DoseMark(1, at("2026-03-0${day}T08:00"), Medicines.TAKEN, 1))
    s.mark(DoseMark(1, at("2026-03-03T08:00"), Medicines.SKIPPED, 1))
  }

  @Test fun adherenceCountsMarkedDosesNotPendingOnes() {
    val s = store(med())
    weekOfMarks(s)
    val now = at("2026-03-10T09:00")
    s.state = ReminderState(now, emptyList())
    val week = Medicines.adherence(s, "week", now, karachi)
    assertEquals(d("2026-03-04"), week.fromDay)
    assertEquals(Adherence(null, 6, 0, 0, 100, 6), week.all)
    assertEquals(listOf(Adherence(1, 6, 0, 0, 100, 6)), week.medicines)
    val month = Medicines.adherence(s, "month", now, karachi)
    assertEquals(d("2026-02-09"), month.fromDay)
    assertEquals(Adherence(null, 6, 1, 0, 86, 6), month.all)
  }

  @Test fun anUnsweptPassedDoseCountsAsMissed() {
    val s = store(med())
    weekOfMarks(s)
    s.state = ReminderState(at("2026-03-10T07:00"), emptyList())
    val r = Medicines.adherence(s, "week", at("2026-03-10T13:00"), karachi)
    assertEquals(Adherence(null, 6, 0, 1, 86, 0), r.all)
  }

  @Test fun streakCountsTodayOnlyWhenEveryDoseIsTaken() {
    val s = store(med(times = listOf("08:00", "20:00")))
    for (day in 7..9) {
      s.mark(DoseMark(1, at("2026-03-0${day}T08:00"), Medicines.TAKEN, 1))
      s.mark(DoseMark(1, at("2026-03-0${day}T20:00"), Medicines.TAKEN, 1))
    }
    val now = at("2026-03-10T09:00")
    s.state = ReminderState(now, emptyList())
    assertEquals(3, Medicines.adherence(s, "week", now, karachi).all.streak)
    s.mark(DoseMark(1, at("2026-03-10T08:00"), Medicines.TAKEN, now))
    assertEquals(3, Medicines.adherence(s, "week", now, karachi).all.streak)
    s.mark(DoseMark(1, at("2026-03-10T20:00"), Medicines.TAKEN, now))
    assertEquals(4, Medicines.adherence(s, "week", now, karachi).all.streak)
    s.mark(DoseMark(1, at("2026-03-10T20:00"), Medicines.SKIPPED, now))
    assertEquals(0, Medicines.adherence(s, "week", now, karachi).all.streak)
  }

  @Test fun daysWithoutDosesNeitherAddNorBreak() {
    val byDay = mapOf(
      d("2026-03-10") to listOf(Dose(1, 0, 0, Medicines.TAKEN, 1)),
      d("2026-03-08") to listOf(Dose(1, 0, 0, Medicines.TAKEN, 1)),
      d("2026-03-07") to listOf(Dose(1, 0, 0, Medicines.MISSED, 1)),
      d("2026-03-06") to listOf(Dose(1, 0, 0, Medicines.TAKEN, 1)),
    )
    assertEquals(2, Medicines.streak(byDay, d("2026-03-10"), d("2026-01-01")))
    assertEquals(0, Medicines.streak(emptyMap(), d("2026-03-10"), d("2026-01-01")))
  }

  @Test fun theStreakForAllNeedsEveryMedicine() {
    val s = store(med(), med(id = 2))
    for (day in 8..9) s.mark(DoseMark(1, at("2026-03-0${day}T08:00"), Medicines.TAKEN, 1))
    s.mark(DoseMark(2, at("2026-03-09T08:00"), Medicines.TAKEN, 1))
    s.mark(DoseMark(2, at("2026-03-08T08:00"), Medicines.SKIPPED, 1))
    val now = at("2026-03-10T07:00")
    s.state = ReminderState(now, emptyList())
    val r = Medicines.adherence(s, "week", now, karachi)
    assertEquals(1, r.all.streak)
    assertEquals(listOf(2, 1), r.medicines.map { it.streak })
    assertEquals(listOf(100, 50), r.medicines.map { it.percent })
  }

  @Test fun aDstDayCountsItsDosesOnce() {
    val m = med(times = listOf("01:30", "08:00"), createdAt = 0)
    val s = store(m)
    val gapDose = utc("2026-03-29T01:00:00Z")
    s.mark(DoseMark(1, gapDose, Medicines.TAKEN, 1))
    s.mark(DoseMark(1, utc("2026-03-29T07:00:00Z"), Medicines.TAKEN, 1))
    val now = utc("2026-03-29T22:00:00Z")
    s.state = ReminderState(now, emptyList())
    val r = Medicines.adherence(s, "week", now, london)
    assertEquals(2, r.all.taken)
    assertEquals(1, r.all.streak)
    assertEquals(gapDose + 4 * hour, Medicines.windowEnd(m, gapDose, london))
  }

  @Test fun theStateRoundTripsAndBadTextIsNull() {
    val st = ReminderState(42, listOf(Snooze(1, 2, 3, 4), Snooze(5, 6, 1, 8)))
    assertEquals(st, Medicines.parseState(Medicines.stateText(st)))
    assertEquals(ReminderState(7, emptyList()), Medicines.parseState("7;"))
    assertNull(Medicines.parseState(null))
    assertNull(Medicines.parseState("x;"))
    assertNull(Medicines.parseState("7;1:2:3"))
    assertNotNull(Medicines.parseState(Medicines.stateText(ReminderState(0, emptyList()))))
  }
}
