package expo.modules.deputyagent.core

import java.time.DayOfWeek
import java.time.DayOfWeek.FRIDAY
import java.time.DayOfWeek.MONDAY
import java.time.DayOfWeek.SUNDAY
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ScheduleTest {
  private val every = DayOfWeek.entries.toSet()
  private val weekdays = every - setOf(DayOfWeek.SATURDAY, SUNDAY)
  private fun s(hour: Int, minute: Int, days: Set<DayOfWeek> = every, enabled: Boolean = true, task: String = "Read my next alarm") =
    Schedule("s1", "Alarm", task, hour, minute, days, enabled, 0L)
  private fun at(iso: String) = Instant.parse(iso)
  private val utc = ZoneOffset.UTC
  private val london = ZoneId.of("Europe/London")
  private val karachi = ZoneId.of("Asia/Karachi")
  private val monday = "2026-11-23"
  private val friday = "2026-11-27"

  @Test fun dailyRunsLaterTodayOrElseTomorrow() {
    assertEquals(at("${monday}T08:00:00Z"), s(8, 0).nextRun(at("${monday}T07:59:00Z"), utc))
    assertEquals(at("2026-11-24T08:00:00Z"), s(8, 0).nextRun(at("${monday}T08:00:00Z"), utc))
  }

  @Test fun theTimeIsTheOwnersLocalTime() {
    assertEquals(at("2026-11-24T03:00:00Z"), s(8, 0).nextRun(at("${monday}T03:00:00Z"), karachi))
  }

  @Test fun weekdaysSkipTheWeekend() {
    assertEquals(at("2026-11-30T08:00:00Z"), s(8, 0, weekdays).nextRun(at("${friday}T09:00:00Z"), utc))
  }

  @Test fun weeklyWaitsAWeekOnceTodaysTimeHasGone() {
    assertEquals(at("2026-11-30T08:00:00Z"), s(8, 0, setOf(MONDAY)).nextRun(at("${monday}T08:30:00Z"), utc))
    assertEquals(at("${friday}T18:15:00Z"), s(18, 15, setOf(FRIDAY)).nextRun(at("${monday}T08:30:00Z"), utc))
  }

  @Test fun aSwitchedOffScheduleNeverRuns() {
    assertNull(s(8, 0, enabled = false).nextRun(at("${monday}T07:00:00Z"), utc))
  }

  @Test fun aTimeTheClocksSkipRunsAnHourLaterThatDay() {
    // London springs forward at 01:00 on 2027-03-28, so 01:30 doesn't exist; it runs at 02:30 BST (01:30 UTC).
    assertEquals(at("2027-03-28T01:30:00Z"), s(1, 30).nextRun(at("2027-03-28T00:00:00Z"), london))
    assertEquals(at("2027-03-29T00:30:00Z"), s(1, 30).nextRun(at("2027-03-28T01:30:00Z"), london))
  }

  @Test fun aTimeThatHappensTwiceRunsOnce() {
    // London falls back at 02:00 BST on 2026-10-25, so 01:30 comes at 00:30 UTC and again at 01:30 UTC.
    val first = s(1, 30).nextRun(at("2026-10-25T00:00:00Z"), london)!!
    assertEquals(at("2026-10-25T00:30:00Z"), first)
    assertEquals(at("2026-10-26T01:30:00Z"), s(1, 30).nextRun(first, london))
  }

  @Test fun needsANameATaskATimeAndADay() {
    assertThrows(IllegalArgumentException::class.java) { s(8, 0).copy(name = " ") }
    assertThrows(IllegalArgumentException::class.java) { s(8, 0).copy(task = "") }
    assertThrows(IllegalArgumentException::class.java) { s(24, 0) }
    assertThrows(IllegalArgumentException::class.java) { s(8, 60) }
    assertThrows(IllegalArgumentException::class.java) { s(8, 0, emptySet()) }
  }

  @Test fun aListSurvivesTheStoredJsonAndBadEntriesAreSkipped() {
    val list = listOf(s(8, 0, weekdays), s(21, 5, setOf(SUNDAY), enabled = false).copy(id = "s2"))
    assertEquals(list, Schedule.fromJson(Schedule.toJson(list)))
    assertEquals(emptyList<Schedule>(), Schedule.fromJson("{oops"))
    val bad = """{"id":"x","name":"n","task":"t","hour":8,"minute":0,"days":[],"enabled":true,"createdAt":0}"""
    assertEquals(list.take(1), Schedule.fromJson("[$bad,${Schedule.toJson(list.take(1)).removeSurrounding("[", "]")}]"))
  }

  private val due = at("${monday}T08:00:00Z").toEpochMilli()
  private val starts = mutableListOf<Triple<String, Set<String>?, List<String>>>()
  private fun begin(schedule: Schedule = s(8, 0), now: Long = due, blocker: String? = null, allowPayments: Boolean = true, fail: Exception? = null) =
    ScheduledRun.begin(schedule, due, now, utc, blocker, allowPayments) { task, apps, untrusted ->
      fail?.let { throw it }
      starts += Triple(task, apps, untrusted)
      "r1"
    }

  @Test fun aDueScheduleStartsItsTaskLikeATypedTask() {
    assertEquals(Begin.Started("r1"), begin())
    assertEquals(listOf(Triple("Read my next alarm", null, emptyList<String>())), starts)
  }

  @Test fun aLittleLateStillRunsOnceButLongMissedIsSkippedNotCaughtUp() {
    assertEquals(Begin.Started("r1"), begin(now = due + ScheduledRun.LATE_MS))
    val skipped = begin(now = due + 3 * 86_400_000L)
    assertEquals(Begin.Failed("Your phone was off or asleep at 08:00, so Deputy skipped this one."), skipped)
    assertEquals(1, starts.size)
  }

  @Test fun aBlockedStartIsSkippedWithItsReason() {
    val reason = ScheduledRun.blocker(serviceOn = true, keySet = true, busy = false, unlocked = false)!!
    assertEquals(Begin.Failed(reason), begin(blocker = reason))
    assertTrue(starts.isEmpty())
  }

  @Test fun eachBlockerHasItsOwnPlainReason() {
    assertNull(ScheduledRun.blocker(serviceOn = true, keySet = true, busy = false, unlocked = true))
    val reasons = listOf(
      ScheduledRun.blocker(serviceOn = false, keySet = true, busy = false, unlocked = true),
      ScheduledRun.blocker(serviceOn = true, keySet = false, busy = false, unlocked = true),
      ScheduledRun.blocker(serviceOn = true, keySet = true, busy = true, unlocked = true),
      ScheduledRun.blocker(serviceOn = true, keySet = true, busy = false, unlocked = false),
    )
    assertEquals(4, reasons.filterNotNull().toSet().size)
    assertTrue(reasons[2]!!.contains("busy"))
  }

  @Test fun aRefusedStartIsSkippedWithItsMessage() {
    assertEquals(Begin.Failed("Deputy is already doing a task. Stop it first."), begin(fail = IllegalStateException("Deputy is already doing a task. Stop it first.")))
  }

  @Test fun paymentTasksFollowTheOwnersSwitch() {
    val pay = s(8, 0, task = "Pay my electricity bill in the bank app")
    assertEquals(Begin.Started("r1"), begin(pay, allowPayments = true))
    assertEquals(Begin.Failed(ScheduledRun.NO_PAYMENTS), begin(pay, allowPayments = false))
    assertNull(ScheduledRun.paymentRefusal("Tell me my bank balance", allowed = false))
    assertEquals(ScheduledRun.NO_PAYMENTS, ScheduledRun.paymentRefusal("Top up my phone", allowed = false))
    assertEquals(1, starts.size)
  }

  @Test fun runEndsMapToPlainOutcomes() {
    assertEquals(Outcome.FINISHED, Outcome.of(RunStatus.DONE))
    assertEquals(Outcome.STOPPED, Outcome.of(RunStatus.DECLINED))
    assertEquals(Outcome.STOPPED, Outcome.of(RunStatus.CAPPED))
    assertEquals(Outcome.FAILED, Outcome.of(RunStatus.INTERRUPTED))
  }
}
