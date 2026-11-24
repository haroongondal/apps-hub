package expo.modules.deputyagent.core

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ScheduleLogTest {
  @get:Rule val tmp = TemporaryFolder()
  private var clock = 1_795_420_800_000L
  private val day = 86_400_000L
  private fun log() = ScheduleLog(tmp.root, { clock })

  @Test fun aStartedRunEndsWithItsOutcomeAndKeepsItsLink() {
    val log = log()
    log.started("s1", "r1")
    log.ended("s1", "r1", RunResult(RunStatus.DONE, "Your next alarm is 07:30."))
    assertEquals(listOf(ScheduleRun(clock, Outcome.FINISHED, "Your next alarm is 07:30.", "r1")), log.list("s1", null, false))
  }

  @Test fun aRunThatEndsBeforeItsStartIsWrittenIsOneRecord() {
    val log = log()
    log.ended("s1", "r1", RunResult(RunStatus.CAPPED, "You reached today's spending limit."))
    log.started("s1", "r1")
    assertEquals(listOf(ScheduleRun(clock, Outcome.STOPPED, "You reached today's spending limit.", "r1")), log.list("s1", null, false))
  }

  @Test fun aRunGoingOnNowShowsWhetherItWaitsForTheOwner() {
    val log = log()
    log.started("s1", "r1")
    assertEquals(Outcome.RUNNING, log.list("s1", "r1", gatePending = false).single().outcome)
    assertEquals(Outcome.WAITING, log.list("s1", "r1", gatePending = true).single().outcome)
  }

  @Test fun aRunWithNoEndThatIsntGoingOnWasCutOff() {
    val log = log()
    log.started("s1", "r1")
    assertEquals(ScheduleRun(clock, Outcome.FAILED, ScheduleLog.CUT_OFF, "r1"), ScheduleLog(tmp.root, { clock }).list("s1", "r2", true).single())
  }

  @Test fun skipsAreRecordedNewestFirstWithTheirReason() {
    val log = log()
    log.skipped("s1", "Your phone was locked. Unlock it and tap Run now.")
    clock += 60_000
    log.started("s1", "r2")
    val list = log.list("s1", null, false)
    assertEquals(listOf("r2", null), list.map { it.runId })
    assertEquals(ScheduleRun(clock - 60_000, Outcome.SKIPPED, "Your phone was locked. Unlock it and tap Run now.", null), list[1])
  }

  @Test fun keepsTheNewestThirtyAndNothingOlderThanThirtyDays() {
    val log = log()
    repeat(35) { i -> log.skipped("s1", "skip $i"); clock += 60_000 }
    assertEquals((34 downTo 5).map { "skip $it" }, log.list("s1", null, false).map { it.summary })
    clock += 31 * day
    log.skipped("s1", "new")
    assertEquals(listOf("new"), log.list("s1", null, false).map { it.summary })
  }

  @Test fun schedulesKeepSeparateHistoriesAndDeleteAndClearRemoveThem() {
    val log = log()
    log.skipped("s1", "a")
    log.skipped("s2", "b")
    assertEquals(listOf("b"), log.list("s2", null, false).map { it.summary })
    log.delete("s1")
    assertTrue(log.list("s1", null, false).isEmpty())
    assertFalse(File(tmp.root, "schedules/s1.jsonl").exists())
    log.clear()
    assertTrue(log.list("s2", null, false).isEmpty())
  }

  @Test fun aLongEndSummaryIsCutAndAnUnreadableLineIsSkipped() {
    val log = log()
    log.started("s1", "r1")
    log.ended("s1", "r1", RunResult(RunStatus.FAILED, "x".repeat(1000)))
    File(tmp.root, "schedules/s1.jsonl").appendText("{oops\n")
    assertEquals(ScheduleLog.SUMMARY_MAX, log.list("s1", null, false).single().summary.length)
  }
}
