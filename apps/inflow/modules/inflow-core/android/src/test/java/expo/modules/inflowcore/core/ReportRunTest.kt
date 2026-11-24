package expo.modules.inflowcore.core

import expo.modules.aihubclient.core.Kinds
import java.time.Instant
import java.time.ZoneId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReportRunTest {
  private val karachi = ZoneId.of("Asia/Karachi")
  private fun at(local: String) = Instant.parse("${local}Z").toEpochMilli() - 5 * 3_600_000L

  private val store = MemoryReportStore()
  private var clock = at("2025-11-16T21:30:00")   // Sunday 21:30: the week of 10-16 Nov has just ended
  private var cap = false
  private var aiOn = true
  private var offline = false
  private var slow = false
  private val bodies = mutableListOf<String>()
  private var code = 200
  private val prompts = mutableListOf<String>()
  private var spent = 0
  private val allNotified = mutableListOf<Pair<Long, String>>()
  private val notified get() = allNotified.filter { it.second.startsWith("Week") }   // an empty month is also "ready", and tells the owner too
  private var txnId = 1L

  /** A reply valid for the period in the request: it names the period's second day. */
  private var answer: (String) -> String = { prompt -> good(Regex("to (\\d{4}-\\d{2}-\\d{2})").find(prompt)!!.groupValues[1]) }

  private fun good(date: String) = """
    {"currencies":[{"currency":"PKR","totals":{"in":0,"out":1500.5,"net":-1500.5,"count":1},
      "own":{"in":0,"out":0,"transfers":[]},
      "categories":[{"name":"Food & dining","direction":"out","amount":1500.5,"count":1,"share":100,"change":null}],
      "parties":[{"name":"KFC","in":0,"out":1500.5,"count":1}],"accounts":[{"name":"Alfalah 2310","in":0,"out":1500.5,"count":1}],
      "daily":[{"date":"$date","out":1500.5}],"largest":[{"date":"$date","name":"KFC","amount":1500.5,"category":"Food & dining"}],
      "fees":{"amount":0,"count":0},"cash":{"amount":0,"count":0}}],
     "insights":["You spent 1,500.50 on food."]}
  """.trimIndent()

  private fun post(json: String): String {
    if (offline) FakeHub.fail(Kinds.PROVIDER)
    bodies += json
    if (slow) FakeHub.fail(Kinds.TIMEOUT)
    prompts += FakeHub.user(json)
    when (code) {
      200 -> Unit
      401 -> FakeHub.fail(Kinds.NO_KEY)
      else -> FakeHub.fail(Kinds.PROVIDER)
    }
    return FakeHub.reply(answer(prompts.last()))
  }

  private val provider = FakeHub.ai(hub = ::post)

  private fun run() = ReportRun(
    store, { if (aiOn) provider else null }, { spent++ }, { cap }, { "Haroon" }, { listOf("Alfalah 2310") }, { clock }, karachi,
  ) { id, headline -> allNotified += id to headline }

  private fun addTxn(local: String, minor: Long = 150_050) {
    store.txnList += Txn(txnId++, Direction.OUT, minor, "PKR", "Alfalah 2310", "KFC", null, at(local), false, false, null, setOf(Channel.SMS), category = "Food & dining")
  }

  private val week1 = ReportSchedule.lastWeek(at("2025-11-16T21:30:00"), karachi)   // 9 Nov 21:00 .. 16 Nov 21:00

  // ---- Review Focus 1

  @Test fun phoneOffAcrossTwoSundaysMakesOnlyTheLastWeekOnce() {
    addTxn("2025-11-10T12:00:00")   // in the week that ended 16 Nov: never made, the phone was off
    addTxn("2025-11-18T12:00:00")   // in the week that ended 23 Nov
    clock = at("2025-11-23T21:30:00") + 45 * 60_000L   // two Sundays have passed since the last tick
    run().runDue()
    val weekly = store.rows.filter { it.kind == ReportKind.WEEKLY }
    assertEquals(1, weekly.size)
    assertEquals(at("2025-11-16T21:00:00"), weekly.single().periodStart)
    assertEquals("ready", weekly.single().status)
    assertEquals(1, prompts.size)
    // A later tick makes nothing again.
    clock += 30 * 60_000L
    run().runDue()
    clock += 30 * 60_000L
    run().runDue()
    assertEquals(1, prompts.size)
    assertEquals(1, store.rows.count { it.kind == ReportKind.WEEKLY })
    assertEquals(1, notified.size)
  }

  @Test fun theMonthlyReportIsMadeForTheLastMonthOnly() {
    addTxn("2025-10-15T12:00:00")
    clock = at("2025-12-01T00:10:00")
    run().runDue()
    val monthly = store.rows.single { it.kind == ReportKind.MONTHLY }
    assertEquals(at("2025-11-01T00:00:00"), monthly.periodStart)   // the October txn belongs to a month nobody asked for
    assertTrue(prompts.isEmpty())   // November had no transactions
  }

  // ---- Review Focus 5

  @Test fun anEmptyWeekIsReadyWithoutAnAiCall() {
    run().runDue()
    val row = store.rows.single { it.kind == ReportKind.WEEKLY }
    assertEquals("ready", row.status)
    assertEquals("Week of 10–16 Nov: no transactions", row.headline)
    assertTrue(prompts.isEmpty())
    val json = Json.parseToJsonElement(store.stored.first { it.row.kind == ReportKind.WEEKLY }.json!!).jsonObject
    assertEquals(0, json["currencies"]!!.jsonArray.size)
    assertEquals(ReportJson.NO_TXNS, json["insights"]!!.jsonArray.single().jsonPrimitive.content)
    assertEquals(0, spent)
  }

  // ---- caps and errors

  @Test fun theCapMakesItWaitWithoutCountingATry() {
    addTxn("2025-11-10T12:00:00")
    cap = true
    run().runDue()
    val row = store.rows.single { it.kind == ReportKind.WEEKLY }
    assertEquals("waiting", row.status)
    assertEquals(ReportRun.CAP_WAIT, row.message)
    assertEquals(0, row.tries)
    assertTrue(prompts.isEmpty())
    cap = false
    clock += 30 * 60_000L
    run().runDue()
    assertEquals("ready", store.rows.single { it.kind == ReportKind.WEEKLY }.status)
    assertEquals(1, prompts.size)
  }

  @Test fun aHubThatIsNotReadyWaitsWithoutCountingATry() {
    addTxn("2025-11-10T12:00:00")
    code = 401
    run().runDue()
    var row = store.rows.single { it.kind == ReportKind.WEEKLY }
    assertEquals("waiting", row.status)
    assertEquals(0, row.tries)
    assertEquals(HubCopy.NO_KEY, row.message)
    code = 200
    run().runDue()
    assertEquals("ready", store.rows.single { it.kind == ReportKind.WEEKLY }.status)
  }

  @Test fun aTimeoutCountsATryAndThreeOfThemFail() {
    addTxn("2025-11-10T12:00:00")
    slow = true
    val r = run()
    r.runDue()
    var row = store.rows.single { it.kind == ReportKind.WEEKLY }
    assertEquals("waiting", row.status)
    assertEquals(1, row.tries)
    assertEquals("The AI took too long to answer. Inflow will try again later.", row.message)
    repeat(2) { r.runDue() }
    row = store.rows.single { it.kind == ReportKind.WEEKLY }
    assertEquals("failed", row.status)
    assertEquals(3, row.tries)
    assertEquals(3, bodies.size)
  }

  @Test fun aServerErrorCountsATryAndThreeOfThemFail() {
    addTxn("2025-11-10T12:00:00")
    code = 503
    val r = run()
    repeat(3) { r.runDue() }
    val row = store.rows.single { it.kind == ReportKind.WEEKLY }
    assertEquals("failed", row.status)
    assertEquals(3, row.tries)
  }

  @Test fun aFailureBeforeTheNewPartialIsSavedKeepsTheOlderPartial() {
    addTxn("2025-11-10T12:00:00")
    addTxn("2025-11-17T12:00:00")
    clock = at("2025-11-12T12:00:00")
    assertTrue(run().make(ReportSchedule.weekSoFar(clock, karachi), manual = true).first)
    clock = at("2025-11-19T12:00:00")
    answer = { _ -> throw IllegalStateException("boom") }
    try { run().make(ReportSchedule.weekSoFar(clock, karachi), manual = true) } catch (e: IllegalStateException) {}
    assertEquals(1, store.rows.count { it.partial })
    assertEquals("ready", store.rows.single { it.partial }.status)
  }

  @Test fun reportsAskForAtMost8000Tokens() {
    addTxn("2025-11-10T12:00:00")
    run().runDue()
    assertTrue(bodies.first().contains("\"maxTokens\":8000"))
  }

  @Test fun makingAPartialDeletesTheOlderPartials() {
    addTxn("2025-11-10T12:00:00")
    addTxn("2025-11-17T12:00:00")
    clock = at("2025-11-12T12:00:00")
    assertTrue(run().make(ReportSchedule.weekSoFar(clock, karachi), manual = true).first)
    clock = at("2025-11-19T12:00:00")
    assertTrue(run().make(ReportSchedule.weekSoFar(clock, karachi), manual = true).first)
    val partials = store.rows.filter { it.partial }
    assertEquals(1, partials.size)
    assertEquals(ReportSchedule.weekSoFar(clock, karachi).start, partials.single().periodStart)
  }

  @Test fun threeBadRepliesFailAndAFourthTickMakesNoCall() {
    addTxn("2025-11-10T12:00:00")
    answer = { _ -> "I am sorry, I cannot do that." }
    val r = run()
    r.runDue()
    var row = store.rows.single { it.kind == ReportKind.WEEKLY }
    assertEquals("waiting", row.status); assertEquals(1, row.tries); assertEquals(ReportRun.RETRY, row.message)
    r.runDue()
    row = store.rows.single { it.kind == ReportKind.WEEKLY }
    assertEquals("waiting", row.status); assertEquals(2, row.tries)
    r.runDue()
    row = store.rows.single { it.kind == ReportKind.WEEKLY }
    assertEquals("failed", row.status); assertEquals(3, row.tries); assertEquals(ReportRun.FAILED_COPY, row.message)
    assertEquals(3, prompts.size)
    r.runDue()
    assertEquals(3, prompts.size)
    assertTrue(notified.isEmpty())
    assertEquals(3, spent)   // every reply cost money, good or not
  }

  @Test fun tryAgainStartsTheTriesOver() {
    addTxn("2025-11-10T12:00:00")
    answer = { _ -> "nope" }
    val r = run()
    repeat(3) { r.runDue() }
    assertEquals("failed", store.rows.single { it.kind == ReportKind.WEEKLY }.status)
    answer = { prompt -> good(Regex("to (\\d{4}-\\d{2}-\\d{2})").find(prompt)!!.groupValues[1]) }
    val (ok, message) = r.make(week1, manual = true)
    assertTrue(ok); assertNull(message)
    val row = store.rows.single { it.kind == ReportKind.WEEKLY }
    assertEquals("ready", row.status)
    assertEquals(0, row.tries)
    assertTrue(notified.isEmpty())   // a manual one never notifies
  }

  @Test fun tooManyTransactionsFailAtOnce() {
    repeat(ReportJson.MAX_TXNS + 1) { addTxn("2025-11-10T12:00:00") }
    run().runDue()
    val row = store.rows.single { it.kind == ReportKind.WEEKLY }
    assertEquals("failed", row.status)
    assertEquals(ReportRun.TOO_MANY, row.message)
    assertEquals(3, row.tries)
    assertTrue(prompts.isEmpty())
    run().runDue()
    assertTrue(prompts.isEmpty())
  }

  @Test fun aiOffMakesNothing() {
    addTxn("2025-11-10T12:00:00")
    aiOn = false
    run().runDue()
    assertTrue(store.rows.isEmpty())
    assertEquals(false to ReportRun.AI_OFF, run().make(week1, manual = true))
  }

  // ---- ready: partial, notify, prune

  @Test fun aReadyWeeklyDeletesThePartialAndNotifiesOnce() {
    addTxn("2025-11-10T12:00:00")
    addTxn("2025-11-17T12:00:00")
    clock = at("2025-11-19T12:00:00")
    val partial = ReportSchedule.weekSoFar(clock, karachi)
    assertTrue(run().make(partial, manual = true).first)
    assertEquals(1, store.rows.count { it.partial })
    assertTrue(notified.isEmpty())
    // The week ends; the next tick makes the real report, drops the partial and tells the owner once.
    clock = at("2025-11-23T21:05:00")
    run().runDue()
    assertEquals(0, store.rows.count { it.partial })
    assertEquals(1, notified.size)
    assertTrue(notified.single().second.startsWith("Week of 17–23 Nov: out PKR 1,500.50"))
    clock += 30 * 60_000L
    run().runDue()
    assertEquals(1, notified.size)
  }

  @Test fun aPartialNeverNotifiesAndSendsNoPreviousReport() {
    addTxn("2025-11-10T12:00:00")
    run().runDue()   // week 1 ready: a previous report now exists
    allNotified.clear()
    prompts.clear()
    clock = at("2025-11-19T12:00:00")
    addTxn("2025-11-18T12:00:00")
    assertTrue(run().make(ReportSchedule.weekSoFar(clock, karachi), manual = false).first)
    assertTrue(notified.isEmpty())
    assertTrue(prompts.single().contains("Previous report of the same kind: none."))
  }

  @Test fun theNextWeekGetsThePreviousOne() {
    addTxn("2025-11-10T12:00:00")
    addTxn("2025-11-18T12:00:00")
    run().runDue()
    clock = at("2025-11-23T21:30:00")
    run().runDue()
    assertEquals(2, prompts.size)
    assertFalse(prompts[0].contains("Previous report of the same kind: [{"))
    assertTrue(prompts[1].contains("Previous report of the same kind: [{"))
    assertTrue(prompts[1].contains("\"Food & dining\""))
  }

  @Test fun theHeadlineAndJsonAreStored() {
    addTxn("2025-11-10T12:00:00")
    run().runDue()
    val s = store.stored.first { it.row.kind == ReportKind.WEEKLY }
    assertEquals("Week of 10–16 Nov: out PKR 1,500.50, top Food & dining", s.row.headline)
    assertNotNull(s.json)
    assertEquals(s.row.id, notified.single().first)
  }

  @Test fun pruneKeepsEightWeeklyAndFourMonthly() {
    val base = at("2025-01-05T21:00:00")
    val week = 7 * 86_400_000L
    repeat(10) { i -> store.save(Period(ReportKind.WEEKLY, base + i * week, base + (i + 1) * week, false), "ready", null, 0, "h$i", "{}", 1) }
    repeat(6) { i -> store.save(Period(ReportKind.MONTHLY, base + i * 30 * 86_400_000L, base + (i + 1) * 30 * 86_400_000L, false), "ready", null, 0, "m$i", "{}", 1) }
    store.save(ReportSchedule.weekSoFar(base + 20 * week, karachi), "ready", null, 0, "partial", "{}", 1)   // a partial is not counted
    store.prune()
    val weekly = store.rows.filter { it.kind == ReportKind.WEEKLY && !it.partial }
    assertEquals(8, weekly.size)
    assertEquals((2..9).map { "h$it" }.toSet(), weekly.map { it.headline }.toSet())
    assertEquals((2..5).map { "m$it" }.toSet(), store.rows.filter { it.kind == ReportKind.MONTHLY }.map { it.headline }.toSet())
    assertEquals(1, store.rows.count { it.partial })
  }

  @Test fun aRunPrunes() {
    val week = 7 * 86_400_000L
    repeat(8) { i -> store.save(Period(ReportKind.WEEKLY, week1.start - (i + 1) * week, week1.end - (i + 1) * week, false), "ready", null, 0, "old$i", "{}", 1) }
    addTxn("2025-11-10T12:00:00")
    run().runDue()
    val weekly = store.rows.filter { it.kind == ReportKind.WEEKLY }
    assertEquals(8, weekly.size)
    assertFalse(weekly.any { it.headline == "old7" })
  }
}
