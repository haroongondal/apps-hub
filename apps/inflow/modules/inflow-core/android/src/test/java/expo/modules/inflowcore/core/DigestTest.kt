package expo.modules.inflowcore.core

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DigestTest {
  private val zone = ZoneId.of("Asia/Karachi")
  private fun at(s: String, z: ZoneId = zone) = LocalDateTime.parse(s).atZone(z).toInstant().toEpochMilli()

  // ---- nextAt

  @Test fun nextAtIsTheNextEightOrTwentyStrictlyAfterNow() {
    assertEquals(at("2026-11-24T08:00"), Digest.nextAt(at("2026-11-24T07:59"), zone))
    assertEquals(at("2026-11-24T20:00"), Digest.nextAt(at("2026-11-24T08:00"), zone))   // strictly after: exactly 08:00 asks for 20:00
    assertEquals(at("2026-11-24T20:00"), Digest.nextAt(at("2026-11-24T12:00"), zone))
    assertEquals(at("2026-11-25T08:00"), Digest.nextAt(at("2026-11-24T20:00"), zone))
  }

  @Test fun nextAtCrossesTheEndOfTheDayAndTheMonthAndTheYear() {
    assertEquals(at("2026-11-25T08:00"), Digest.nextAt(at("2026-11-24T23:59:59"), zone))
    assertEquals(at("2026-12-01T08:00"), Digest.nextAt(at("2026-11-30T21:00"), zone))
    assertEquals(at("2027-01-01T08:00"), Digest.nextAt(at("2026-12-31T20:00:01"), zone))
  }

  @Test fun nextAtFollowsTheZoneNotTheClockOfAnotherZone() {
    val now = at("2026-11-24T07:00", ZoneId.of("UTC"))   // 12:00 in Karachi
    assertEquals(at("2026-11-24T20:00"), Digest.nextAt(now, zone))
    assertEquals(at("2026-11-24T08:00", ZoneId.of("UTC")), Digest.nextAt(now, ZoneId.of("UTC")))
    assertEquals(at("2026-11-25T08:00", ZoneId.of("Pacific/Kiritimati")), Digest.nextAt(now, ZoneId.of("Pacific/Kiritimati")))   // +14: already 21:00 there, so tomorrow 08:00 local
  }

  @Test fun nextAtKeepsLocalTimeAcrossAnHourChange() {
    val ny = ZoneId.of("America/New_York")
    // Spring forward on 2026-03-08 (a 23-hour day): 20:00 on the 8th is EDT, the next morning is 08:00 EDT.
    assertEquals(at("2026-03-08T20:00", ny), Digest.nextAt(at("2026-03-08T12:00", ny), ny))
    assertEquals(at("2026-03-09T08:00", ny), Digest.nextAt(at("2026-03-08T20:00", ny), ny))
    assertEquals(at("2026-03-08T08:00", ny), Digest.nextAt(at("2026-03-07T20:00", ny), ny))
    // Fall back on 2026-11-01 (a 25-hour day).
    assertEquals(at("2026-11-01T20:00", ny), Digest.nextAt(at("2026-11-01T08:00", ny), ny))
    assertEquals(at("2026-11-02T08:00", ny), Digest.nextAt(at("2026-11-01T20:00", ny), ny))
    assertEquals(25 * 3_600_000L, at("2026-11-02T00:00", ny) - at("2026-11-01T00:00", ny))
  }

  @Test fun nextAtAnswersEvenWhenTheDayAfterDoesNotExist() {
    val apia = ZoneId.of("Pacific/Apia")   // 30 Dec 2011 never happened there
    val now = at("2011-12-29T21:00", apia)
    val next = Digest.nextAt(now, apia)
    assertTrue(next > now)
    assertTrue(next - now < 48 * 3_600_000L)
  }

  // ---- kindAt

  @Test fun anAlarmIsForTheSlotItJustPassedAndNeverForAStaleOne() {
    assertEquals(DigestKind.MORNING, Digest.kindAt(at("2026-11-24T08:00:30"), zone))
    assertEquals(DigestKind.MORNING, Digest.kindAt(at("2026-11-24T10:59"), zone))
    assertNull(Digest.kindAt(at("2026-11-24T11:01"), zone))   // fired hours late
    assertEquals(DigestKind.EVENING, Digest.kindAt(at("2026-11-24T20:05"), zone))
    assertEquals(DigestKind.EVENING, Digest.kindAt(at("2026-11-25T22:30"), zone))
    assertNull(Digest.kindAt(at("2026-11-25T00:30"), zone))   // yesterday's 20:00 was 4.5 hours ago
    assertNull(Digest.kindAt(at("2026-11-24T07:00"), zone))
  }

  // ---- build

  private val now = at("2026-11-24T08:00:30")

  private class Inputs(
    override val healthOn: Boolean = false,
    val dueList: List<DueThing> = emptyList(),
    val txnList: List<Txn> = emptyList(),
    val source: BriefingHealth? = null,
    val appLines: List<AppLine> = emptyList(),
  ) : BriefingInputs {
    var healthCalls = 0
    override fun due() = dueList
    override fun txns(from: Long, to: Long) = txnList.filter { it.at >= from && it.at < to }
    override fun health(): BriefingHealth {
      healthCalls++
      return source ?: throw AssertionError("the health source was read")
    }
    override fun others() = appLines
  }

  private fun txn(dir: Direction, minor: Long, at: Long, currency: String = "PKR", own: Boolean = false) =
    Txn(0, dir, minor, currency, "HBL ****1234", "CANARY-SHOP", null, at, own, false, null, setOf(Channel.SMS), label = "CANARY-LABEL")

  private val health = MemoryHealthStore().apply { rows["2026-11-24"] = HealthDay("2026-11-24", 6_214, 401, 71, 57) }
  private val meds = MemoryMedicineStore().apply {
    insert(Medicine(0, "CANARY-MEDICINE", "CANARY-DOSE", listOf(LocalTime.of(8, 0), LocalTime.of(14, 0)), DayOfWeek.values().toSet(), LocalDate.parse("2026-11-01"), null, createdAt = at("2026-10-30T00:00")))
  }

  @Test fun theMorningSummaryIsTheBriefingLines() {
    val inputs = Inputs(
      dueList = listOf(DueThing(7, SuggestionKind.BILL, at("2026-11-25T00:00")), DueThing(8, SuggestionKind.EVENT, at("2026-11-24T11:00"))),
      txnList = listOf(txn(Direction.OUT, 420_000, at("2026-11-23T12:00"))),
      appLines = listOf(AppLine(BriefingKind.TASKS, "1 task is waiting for you")),
    )
    val c = Digest.build(DigestKind.MORNING, inputs, now, zone)!!
    assertEquals(Briefing.build(inputs, now, zone).map { it.text }, c.lines)
    assertEquals(listOf("Meeting 11:00 on 24 Nov", "Bill due 25 Nov", "Spent PKR 4,200 yesterday", "1 task is waiting for you"), c.lines)
    assertEquals("Morning summary", c.title)
    assertEquals("4 things today", c.publicText)
  }

  @Test fun theEveningSummaryIsWhatWasSpentTodayAndWhatIsDueTomorrow() {
    val ev = at("2026-11-24T20:00:30")
    val inputs = Inputs(
      dueList = listOf(
        DueThing(1, SuggestionKind.BILL, at("2026-11-26T00:00")), DueThing(2, SuggestionKind.BILL, at("2026-11-25T00:00")),
        DueThing(3, SuggestionKind.EVENT, at("2026-11-25T09:30")), DueThing(4, SuggestionKind.BILL, at("2026-11-24T00:00")), DueThing(5, SuggestionKind.REPLY, at("2026-11-25T10:00")),
      ),
      txnList = listOf(
        txn(Direction.OUT, 300_000, at("2026-11-24T09:00")), txn(Direction.OUT, 120_000, at("2026-11-24T15:00")), txn(Direction.IN, 999_000, at("2026-11-24T10:00")),
        txn(Direction.OUT, 900_000, at("2026-11-24T11:00"), own = true), txn(Direction.OUT, 777_700, at("2026-11-23T11:00")), txn(Direction.OUT, 1_250, at("2026-11-24T12:00"), "USD"),
      ),
      appLines = listOf(AppLine(BriefingKind.HOME, "Ali is home")),
    )
    val c = Digest.build(DigestKind.EVENING, inputs, ev, zone)!!
    assertEquals(listOf("Spent PKR 4,200 today", "Spent USD 12.50 today", "Bill due 25 Nov", "Meeting 09:30 on 25 Nov"), c.lines)
    assertEquals("Evening summary", c.title)
    assertEquals("4 things tonight", c.publicText)
    assertEquals(0, inputs.healthCalls)
  }

  @Test fun nothingToSayIsNoSummaryAtAll() {
    assertNull(Digest.build(DigestKind.MORNING, Inputs(), now, zone))
    assertNull(Digest.build(DigestKind.EVENING, Inputs(), now, zone))
    // Only things that do not count: money in, an own transfer, bills beyond tomorrow.
    val quiet = Inputs(
      dueList = listOf(DueThing(1, SuggestionKind.BILL, at("2026-11-30T00:00"))),
      txnList = listOf(txn(Direction.IN, 500, at("2026-11-24T10:00")), txn(Direction.OUT, 500, at("2026-11-24T10:00"), own = true)),
    )
    assertNull(Digest.build(DigestKind.EVENING, quiet, at("2026-11-24T20:00"), zone))
  }

  @Test fun thePublicTextIsACountAndNothingElse() {
    val inputs = Inputs(
      dueList = listOf(DueThing(7, SuggestionKind.BILL, at("2026-11-25T00:00"))),
      txnList = listOf(txn(Direction.OUT, 420_000, at("2026-11-23T12:00"))),
      appLines = listOf(AppLine(BriefingKind.HOME, "CANARY-NAME is home")),
    )
    val c = Digest.build(DigestKind.MORNING, inputs, now, zone)!!
    assertTrue(c.lines.any { it.contains("CANARY-NAME") })
    assertTrue(c.publicText, Regex("^\\d+ things? (today|tonight)$").matches(c.publicText))
    for (line in c.lines) for (word in Regex("[A-Za-z0-9,.-]+").findAll(line).map { it.value }.filter { it.length > 3 && it.lowercase() != "this" }) assertTrue("$word leaks", !c.publicText.contains(word))
    assertEquals("1 thing today", Digest.publicText(DigestKind.MORNING, 1))
    assertEquals("2 things tonight", Digest.publicText(DigestKind.EVENING, 2))
    assertTrue(c.title.none { it.isDigit() })
  }

  @Test fun atMostFiveLinesEachAtMostSixtyCharactersAndTheCountIsOfTheLinesShown() {
    val many = (1L..9L).map { DueThing(it, SuggestionKind.BILL, at("2026-11-25T10:00") + it) }
    val inputs = Inputs(dueList = many, appLines = listOf(AppLine(BriefingKind.TASKS, "x".repeat(200))))
    val c = Digest.build(DigestKind.MORNING, inputs, now, zone)!!
    assertEquals(5, c.lines.size)
    assertTrue(c.lines.all { it.length <= Digest.MAX_TEXT })
    assertEquals("5 things today", c.publicText)
    val long = Digest.build(DigestKind.MORNING, Inputs(appLines = listOf(AppLine(BriefingKind.TASKS, "y".repeat(200)))), now, zone)!!
    assertEquals(60, long.lines.single().length)
  }

  // ---- the lock screen

  @Test fun aPersonalLineShowsNothingOnTheLockScreen() {
    val home = Digest.build(DigestKind.MORNING, Inputs(dueList = listOf(DueThing(7, SuggestionKind.BILL, at("2026-11-25T00:00"))), appLines = listOf(AppLine(BriefingKind.HOME, "Ali is home"))), now, zone)!!
    assertTrue(home.personal)
    assertNull(Digest.lockScreenText(home))
    val spentYesterday = Digest.build(DigestKind.MORNING, Inputs(txnList = listOf(txn(Direction.OUT, 420_000, at("2026-11-23T12:00")))), now, zone)!!
    assertNull(Digest.lockScreenText(spentYesterday))
    val steps = Digest.build(DigestKind.MORNING, Inputs(healthOn = true, source = StoreBriefingHealth(health, meds)), now, zone)!!
    assertNull(Digest.lockScreenText(steps))
  }

  @Test fun theEveningSpentLineIsPersonal() {
    val ev = at("2026-11-24T20:00:30")
    val c = Digest.build(DigestKind.EVENING, Inputs(dueList = listOf(DueThing(2, SuggestionKind.BILL, at("2026-11-25T00:00"))), txnList = listOf(txn(Direction.OUT, 300_000, at("2026-11-24T09:00")))), ev, zone)!!
    assertEquals(listOf("Spent PKR 3,000 today", "Bill due 25 Nov"), c.lines)
    assertTrue(c.personal)
    assertNull(Digest.lockScreenText(c))
  }

  @Test fun onlyBillAndEventLinesKeepTheCountOnTheLockScreen() {
    val m = Digest.build(DigestKind.MORNING, Inputs(dueList = listOf(DueThing(7, SuggestionKind.BILL, at("2026-11-25T00:00")), DueThing(8, SuggestionKind.EVENT, at("2026-11-24T11:00")))), now, zone)!!
    assertEquals(false, m.personal)
    assertEquals("2 things today", Digest.lockScreenText(m))
    val e = Digest.build(DigestKind.EVENING, Inputs(dueList = listOf(DueThing(2, SuggestionKind.BILL, at("2026-11-25T00:00")))), at("2026-11-24T20:00:30"), zone)!!
    assertEquals("1 thing tonight", Digest.lockScreenText(e))
    for (line in m.lines + e.lines) assertTrue(line, !Digest.lockScreenText(m)!!.contains(line) && !Digest.lockScreenText(e)!!.contains(line))
  }

  @Test fun onlyTheLinesShownDecide() {
    // Five bills fill the five lines; the home line after them is not shown, so the count stays on the lock screen.
    val bills = (1L..5L).map { DueThing(it, SuggestionKind.BILL, at("2026-11-25T10:00") + it) }
    val c = Digest.build(DigestKind.MORNING, Inputs(dueList = bills, appLines = listOf(AppLine(BriefingKind.HOME, "Ali is home"))), now, zone)!!
    assertTrue(c.lines.none { it.contains("Ali") })
    assertEquals("5 things today", Digest.lockScreenText(c))
  }

  // ---- the health gate

  @Test fun healthOffNeverReadsTheHealthSourceInEitherSummary() {
    val loaded = Inputs(healthOn = false, source = StoreBriefingHealth(health, meds), dueList = listOf(DueThing(1, SuggestionKind.BILL, at("2026-11-25T00:00"))))
    val m = Digest.build(DigestKind.MORNING, loaded, now, zone)!!
    val e = Digest.build(DigestKind.EVENING, loaded, at("2026-11-24T20:00"), zone)!!
    assertEquals(0, loaded.healthCalls)
    for (l in m.lines + e.lines) assertTrue(l, !l.contains("Medicine") && !l.contains("steps"))
    assertEquals(listOf("Bill due 25 Nov"), m.lines)
    assertEquals(listOf("Bill due 25 Nov"), e.lines)
  }

  @Test fun healthOnAddsTheBriefingsOwnHealthLinesToTheMorningOnly() {
    val loaded = Inputs(healthOn = true, source = StoreBriefingHealth(health, meds))
    val m = Digest.build(DigestKind.MORNING, loaded, now, zone)!!
    assertEquals(listOf("Medicine at 14:00", "6214 steps"), m.lines)
    assertEquals("2 things today", m.publicText)
    assertTrue(m.lines.none { it.contains("CANARY") })
    assertNull(Digest.build(DigestKind.EVENING, loaded, at("2026-11-24T20:00"), zone))   // no health line in the evening, so nothing to say
    assertEquals(1, loaded.healthCalls)   // only the morning asked
  }

  @Test fun healthOnLeavesTheLockScreenTextFreeOfHealth() {
    val c = Digest.build(DigestKind.MORNING, Inputs(healthOn = true, source = StoreBriefingHealth(health, meds)), now, zone)!!
    assertTrue(c.publicText, !c.publicText.contains("steps") && !c.publicText.contains("Medicine") && !c.publicText.contains("6214"))
    assertNotNull(c.lines.firstOrNull { it.contains("steps") })
  }
}
