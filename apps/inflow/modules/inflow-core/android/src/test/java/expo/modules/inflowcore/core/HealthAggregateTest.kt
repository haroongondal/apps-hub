package expo.modules.inflowcore.core

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthAggregateTest {
  private val karachi = ZoneId.of("Asia/Karachi")
  private val berlin = ZoneId.of("Europe/Berlin")
  private val hour = 3_600_000L
  private val min = 60_000L

  private fun at(s: String, zone: ZoneId = karachi) = LocalDateTime.parse(s).atZone(zone).toInstant().toEpochMilli()
  private fun d(s: String) = LocalDate.parse(s)
  private fun session(a: String, b: String, zone: ZoneId = karachi, stages: List<SleepStage> = emptyList()) = SleepSession(at(a, zone), at(b, zone), stages)

  @Test fun windowsAreContiguousLocalDaysOldestFirst() {
    val w = HealthAggregate.windows(d("2026-03-10"), 3, karachi)
    assertEquals(listOf(d("2026-03-08"), d("2026-03-09"), d("2026-03-10")), w.map { it.day })
    assertEquals(at("2026-03-08T00:00"), w[0].startMs)
    for (i in 1 until w.size) assertEquals(w[i - 1].endMs, w[i].startMs)
    assertTrue(w.all { it.endMs - it.startMs == 24 * hour })
  }

  @Test fun clockChangeDaysAre23And25Hours() {
    val spring = HealthAggregate.windows(d("2026-03-30"), 3, berlin)
    assertEquals(listOf(24 * hour, 23 * hour, 24 * hour), spring.map { it.endMs - it.startMs })
    val autumn = HealthAggregate.windows(d("2026-10-25"), 1, berlin).single()
    assertEquals(25 * hour, autumn.endMs - autumn.startMs)
  }

  @Test fun dayCountIsClampedTo1Through90() {
    assertEquals(90, HealthAggregate.windows(d("2026-03-10"), 500, karachi).size)
    assertEquals(1, HealthAggregate.windows(d("2026-03-10"), 0, karachi).size)
  }

  @Test fun midnightStartsTheNextDay() {
    val w = HealthAggregate.windows(d("2026-03-10"), 2, karachi)
    assertEquals(d("2026-03-10"), HealthAggregate.windowAt(w, at("2026-03-10T00:00"))?.day)
    assertEquals(d("2026-03-09"), HealthAggregate.windowAt(w, at("2026-03-10T00:00") - 1)?.day)
    assertNull(HealthAggregate.windowAt(w, at("2026-03-11T00:00")))
    assertNull(HealthAggregate.windowAt(w, at("2026-03-09T00:00") - 1))
  }

  @Test fun aNightCrossingMidnightBelongsWholeToTheDayItEnds() {
    val w = HealthAggregate.windows(d("2026-03-10"), 2, karachi)
    val m = HealthAggregate.sleepMinutes(listOf(session("2026-03-09T22:00", "2026-03-10T06:00")), w)
    assertEquals(mapOf(d("2026-03-10") to 480), m)
  }

  @Test fun aSessionEndingExactlyAtMidnightBelongsToTheDayBefore() {
    val w = HealthAggregate.windows(d("2026-03-10"), 2, karachi)
    val m = HealthAggregate.sleepMinutes(listOf(session("2026-03-09T16:00", "2026-03-10T00:00")), w)
    assertEquals(mapOf(d("2026-03-09") to 480), m)
  }

  @Test fun overlappingSessionsFromTwoAppsCountOnce() {
    val w = HealthAggregate.windows(d("2026-03-10"), 1, karachi)
    val m = HealthAggregate.sleepMinutes(listOf(session("2026-03-09T22:00", "2026-03-10T06:00"), session("2026-03-09T23:00", "2026-03-10T07:00")), w)
    assertEquals(mapOf(d("2026-03-10") to 540), m)
  }

  @Test fun awakeStagesAreLeftOutAndOverlappingStagesCountOnce() {
    val w = HealthAggregate.windows(d("2026-03-10"), 1, karachi)
    val stages = listOf(
      SleepStage(at("2026-03-09T22:30"), at("2026-03-10T02:00"), true),
      SleepStage(at("2026-03-10T02:00"), at("2026-03-10T02:30"), false),
      SleepStage(at("2026-03-10T02:30"), at("2026-03-10T06:00"), true),
      SleepStage(at("2026-03-10T01:00"), at("2026-03-10T02:00"), true),
    )
    val m = HealthAggregate.sleepMinutes(listOf(session("2026-03-09T22:00", "2026-03-10T06:00", stages = stages)), w)
    assertEquals(mapOf(d("2026-03-10") to 420), m)
  }

  @Test fun aNapAndANightOnTheSameDayAdd() {
    val w = HealthAggregate.windows(d("2026-03-10"), 1, karachi)
    val m = HealthAggregate.sleepMinutes(listOf(session("2026-03-09T23:00", "2026-03-10T06:00"), session("2026-03-10T14:00", "2026-03-10T14:30")), w)
    assertEquals(mapOf(d("2026-03-10") to 450), m)
  }

  @Test fun nightsAcrossClockChangesCountRealTime() {
    val spring = HealthAggregate.sleepMinutes(listOf(session("2026-03-28T23:00", "2026-03-29T07:00", berlin)), HealthAggregate.windows(d("2026-03-29"), 2, berlin))
    assertEquals(mapOf(d("2026-03-29") to 420), spring)
    val autumn = HealthAggregate.sleepMinutes(listOf(session("2026-10-24T23:00", "2026-10-25T07:00", berlin)), HealthAggregate.windows(d("2026-10-25"), 2, berlin))
    assertEquals(mapOf(d("2026-10-25") to 540), autumn)
  }

  @Test fun aNightEndingOutsideTheWindowIsDropped() {
    val w = HealthAggregate.windows(d("2026-03-10"), 1, karachi)
    assertTrue(HealthAggregate.sleepMinutes(listOf(session("2026-03-08T22:00", "2026-03-09T06:00")), w).isEmpty())
  }

  @Test fun lowestIsTheLowestFiveMinuteAverageWithTwoSamples() {
    val w = HealthAggregate.windows(d("2026-03-10"), 1, karachi)
    val t = at("2026-03-10T03:00")
    val samples = listOf(
      HrSample(t, 70), HrSample(t + min, 72),
      HrSample(t + 20 * min, 50),
      HrSample(t + 40 * min, 55), HrSample(t + 43 * min, 57), HrSample(t + 46 * min, 58),
    )
    assertEquals(mapOf(d("2026-03-10") to 56), HealthAggregate.hrLow(samples, w))
  }

  @Test fun aStretchNeverCrossesMidnightAndDuplicatesCountOnce() {
    val w = HealthAggregate.windows(d("2026-03-10"), 2, karachi)
    val midnight = at("2026-03-10T00:00")
    val samples = listOf(HrSample(midnight - 2 * min, 40), HrSample(midnight + min, 40), HrSample(midnight + 10 * min, 66), HrSample(midnight + 10 * min, 66))
    assertTrue(HealthAggregate.hrLow(samples, w).isEmpty())
  }

  @Test fun aSampleLateOnThe25HourDayStaysOnThatDay() {
    val w = HealthAggregate.windows(d("2026-10-25"), 1, berlin)
    val t = at("2026-10-25T23:30", berlin)
    assertEquals(mapOf(d("2026-10-25") to 61), HealthAggregate.hrLow(listOf(HrSample(t, 60), HrSample(t + min, 62)), w))
  }

  @Test fun emptyInputGivesNoRows() {
    val w = HealthAggregate.windows(d("2026-03-10"), 30, karachi)
    assertTrue(HealthAggregate.days(w, emptyMap(), emptyMap(), emptyList(), emptyList()).isEmpty())
  }

  @Test fun daysWithoutDataGiveNoRowAndMissingMetricsStayNull() {
    val w = HealthAggregate.windows(d("2026-03-10"), 3, karachi)
    val t = at("2026-03-10T09:00")
    val rows = HealthAggregate.days(
      w,
      steps = mapOf(d("2026-03-08") to 4200L, d("2026-03-01") to 99L),
      hrAvg = mapOf(d("2026-03-10") to 71L),
      hrSamples = listOf(HrSample(t, 64), HrSample(t + min, 66)),
      sleep = listOf(session("2026-03-09T23:00", "2026-03-10T06:00")),
    )
    assertEquals(
      listOf(HealthDay("2026-03-08", 4200L, null, null, null), HealthDay("2026-03-10", null, 420, 71, 65)),
      rows,
    )
  }

  @Test fun saveReplacesTheWindowAndKeeps400Days() {
    val store = MemoryHealthStore()
    store.rows["2025-02-08"] = HealthDay("2025-02-08", 1, null, null, null)
    store.rows["2025-02-09"] = HealthDay("2025-02-09", 2, null, null, null)
    store.rows["2026-03-01"] = HealthDay("2026-03-01", 3, null, null, null)
    store.rows["2026-03-09"] = HealthDay("2026-03-09", 4, null, null, null)
    val w = HealthAggregate.windows(d("2026-03-15"), 7, karachi)
    HealthAggregate.save(store, w, listOf(HealthDay("2026-03-10", 500, null, null, null)), 77L)
    assertEquals(listOf("2025-02-09", "2026-03-01", "2026-03-10"), store.rows.keys.toList())
    assertEquals(77L, store.updatedAt["2026-03-10"])
    assertEquals(listOf("2026-03-01", "2026-03-10"), store.days("2026-03-01", "2026-03-31").map { it.day })
  }

  @Test fun rowsBecomeTheJsShape() {
    assertEquals(
      mapOf("day" to "2026-03-10", "steps" to 12L, "sleepMinutes" to null, "hrAvg" to 70, "hrLow" to null),
      HealthDay("2026-03-10", 12L, null, 70, null).toMap(),
    )
  }
}
