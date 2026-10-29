package expo.modules.deputyagent.core

import java.io.File
import java.time.ZoneOffset
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class RunStoreTest {
  @get:Rule val tmp = TemporaryFolder()
  private var clock = 1_793_268_900_000L // 2026-10-29T10:15:00Z
  private val day = 86_400_000L
  private fun store() = RunStore(tmp.root, { clock }, ZoneOffset.UTC)
  private fun lines(f: File): List<JsonObject> = f.readLines().map { Json.parseToJsonElement(it).jsonObject }
  private fun JsonObject.s(k: String) = this[k]!!.jsonPrimitive.content

  private fun RunStore.fullRun(id: String, cost: Double) {
    start(id, "task $id", "gemini-3.8-flash", "on_demand")
    record(RunEvent.Finished(id, RunStatus.DONE, "ok", cost))
  }

  @Test fun writesAHeaderOneLinePerStepAndAnEndLine() {
    val s = store()
    s.start("r1", "tell me my next alarm", "gemini-3.8-flash", "on_demand")
    s.record(RunEvent.Step("r1", 1, "Clock", "Open com.clock", "allow", "ok", 0.012))
    s.record(RunEvent.Finished("r1", RunStatus.DONE, "07:30", 0.012))
    val file = File(tmp.root, "runs/20261029-101500-r1.jsonl")
    val (head, step, end) = lines(file)
    assertEquals(listOf("start", "tell me my next alarm", "gemini-3.8-flash", "on_demand"), listOf(head.s("type"), head.s("task"), head.s("model"), head.s("trigger")))
    assertEquals(listOf("step", "1", "Clock", "allow", "ok"), listOf(step.s("type"), step.s("n"), step.s("app"), step.s("verdict"), step.s("result")))
    assertEquals(listOf("end", "done", "07:30", "0.012"), listOf(end.s("type"), end.s("status"), end.s("summary"), end.s("costUsd")))
  }

  @Test fun theActiveMarkerExistsOnlyWhileARunIsOpen() {
    val s = store()
    s.start("r1", "t", "m", "on_demand")
    assertTrue(File(tmp.root, "active").exists())
    s.record(RunEvent.Finished("r1", RunStatus.STOPPED, null, 0.0))
    assertFalse(File(tmp.root, "active").exists())
  }

  @Test fun ac9ARunCutOffByProcessDeathIsClosedAsInterruptedAndNeverResumed() {
    store().apply {
      start("r1", "t", "m", "on_demand")
      record(RunEvent.Step("r1", 1, "Chat", "Tap \"Archive\"", "allow", "ok", 0.012))
    }
    val restarted = store()
    assertEquals("r1", restarted.closeInterrupted())
    assertEquals("interrupted", lines(File(tmp.root, "runs/20261029-101500-r1.jsonl")).last().s("status"))
    assertFalse(File(tmp.root, "active").exists())
    assertEquals("its spend still counts toward the daily cap", 0.012, restarted.spentToday(), 1e-9)
    assertNull(restarted.closeInterrupted())
  }

  @Test fun retentionDropsRunsOlderThan30Days() {
    val s = store()
    clock -= 31 * day
    s.fullRun("old", 0.0)
    clock += 31 * day
    repeat(3) { i -> clock += 1_000; s.fullRun("new$i", 0.0) }
    s.prune()
    assertEquals(setOf("new0", "new1", "new2"), File(tmp.root, "runs").list()!!.map { it.substringAfterLast('-').removeSuffix(".jsonl") }.toSet())
  }

  @Test fun closingInterruptedRunsLeavesThisProcesssOpenRunAlone() {
    val s = store()
    s.start("r1", "t", "m", "on_demand")
    assertNull(s.closeInterrupted())
    assertTrue(File(tmp.root, "active").exists())
  }

  @Test fun retentionKeepsTheNewest200Runs() {
    val s = store()
    s.fullRun("old", 0.0)
    repeat(201) { i -> clock += 1_000; s.fullRun("r$i", 0.0) }
    s.prune()
    val names = File(tmp.root, "runs").list()!!.toSet()
    assertEquals(200, names.size)
    assertFalse(names.any { it.endsWith("-old.jsonl") || it.endsWith("-r0.jsonl") })
    assertTrue(names.any { it.endsWith("-r200.jsonl") })
  }

  @Test fun spentTodayAddsUpTodaysFinishedRunsOnly() {
    val s = store()
    clock -= day
    s.fullRun("yesterday", 1.0)
    clock += day
    s.fullRun("a", 0.5)
    clock += 1_000
    s.fullRun("b", 0.25)
    assertEquals(0.75, s.spentToday(), 1e-9)
  }
}
