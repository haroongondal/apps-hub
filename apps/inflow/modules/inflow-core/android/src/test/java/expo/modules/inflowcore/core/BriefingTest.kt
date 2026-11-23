package expo.modules.inflowcore.core

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BriefingTest {
  private val zone = ZoneId.of("Asia/Karachi")
  private fun at(s: String) = LocalDateTime.parse(s).atZone(zone).toInstant().toEpochMilli()
  private val now = at("2026-11-24T09:00")

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

  @Test fun billsAndEventsDueSoonCarryOnlyKindAndDate() {
    val due = listOf(
      DueThing(7, SuggestionKind.BILL, at("2026-11-25T00:00")),
      DueThing(8, SuggestionKind.EVENT, at("2026-11-24T11:00")),
      DueThing(9, SuggestionKind.EVENT, at("2026-11-24T07:00")),   // already past
      DueThing(10, SuggestionKind.BILL, at("2026-11-27T00:00")),   // after the day after tomorrow
      DueThing(11, SuggestionKind.BILL, at("2026-11-24T00:00")),   // earlier today: still due today
      DueThing(12, SuggestionKind.REPLY, at("2026-11-24T12:00")),
      DueThing(13, SuggestionKind.MONEY, at("2026-11-24T12:00")),
    )
    val lines = Briefing.build(Inputs(dueList = due), now, zone)
    assertEquals(listOf("Bill due 24 Nov", "Meeting 11:00 on 24 Nov", "Bill due 25 Nov"), lines.map { it.text })
    assertEquals(listOf("bill", "event", "bill"), lines.map { it.kind })
    assertEquals(listOf(1_000_000_000_011L, 2_000_000_000_008L, 1_000_000_000_007L), lines.map { it.lineId })
    assertEquals(listOf(at("2026-11-24T00:00"), at("2026-11-24T11:00"), at("2026-11-25T00:00")), lines.map { it.at })
    assertTrue(lines.all { it.sensitive == 0 })
  }

  @Test fun atMostFiveDueLines() {
    val due = (1L..9L).map { DueThing(it, SuggestionKind.BILL, at("2026-11-25T10:00") + it) }
    assertEquals((1L..5L).map { 1_000_000_000_000L + it }, Briefing.build(Inputs(dueList = due), now, zone).map { it.lineId })
  }

  @Test fun theBuilderTakesNoFreeTextForDueThings() {
    assertTrue(DueThing::class.java.declaredFields.none { it.type == String::class.java })
  }

  @Test fun yesterdaysSpendingCountsMoneyOutThatIsNotOwnPerCurrency() {
    val y = at("2026-11-23T12:00")
    val txns = listOf(
      txn(Direction.OUT, 300_000, y), txn(Direction.OUT, 120_000, y), txn(Direction.IN, 500_000, y),
      txn(Direction.OUT, 900_000, y, own = true), txn(Direction.OUT, 777_700, now), txn(Direction.OUT, 1_250, y, "USD"),
      txn(Direction.OUT, 999, at("2026-11-22T23:59")),
    )
    val lines = Briefing.build(Inputs(txnList = txns), now, zone)
    assertEquals(listOf("Spent PKR 4,200 yesterday", "Spent USD 12.50 yesterday"), lines.map { it.text })
    assertEquals(listOf(3_000_000_000_000L, 3_000_000_000_001L), lines.map { it.lineId })
    assertTrue(lines.all { it.kind == "spent" && it.sensitive == 1 && it.at == null })
    assertTrue(lines.none { it.text.contains("CANARY") || it.text.contains("1234") })
  }

  @Test fun noSpendingYesterdayIsNoLine() {
    val y = at("2026-11-23T12:00")
    assertEquals(emptyList<BriefingLine>(), Briefing.build(Inputs(txnList = listOf(txn(Direction.IN, 500_000, y), txn(Direction.OUT, 0, y))), now, zone))
  }

  @Test fun healthOffNeverReadsTheHealthSourceAndHasNoHealthLines() {
    val inputs = Inputs(healthOn = false, dueList = listOf(DueThing(1, SuggestionKind.BILL, at("2026-11-25T00:00"))))
    val lines = Briefing.build(inputs, now, zone)
    assertEquals(0, inputs.healthCalls)
    assertEquals(listOf("bill"), lines.map { it.kind })
    val loaded = Inputs(healthOn = false, source = StoreBriefingHealth(health, meds))
    assertEquals(emptyList<BriefingLine>(), Briefing.build(loaded, now, zone))
    assertEquals(0, loaded.healthCalls)
  }

  @Test fun healthOnGivesTheNextDoseTimeWithoutANameAndTodaysSteps() {
    val inputs = Inputs(healthOn = true, source = StoreBriefingHealth(health, meds))
    val lines = Briefing.build(inputs, now, zone)
    assertEquals(1, inputs.healthCalls)
    assertEquals(listOf("Medicine at 14:00", "6,214 steps"), lines.map { it.text })
    assertEquals(listOf("medicine", "steps"), lines.map { it.kind })
    assertEquals(listOf(1, 1), lines.map { it.sensitive })
    assertEquals(listOf(at("2026-11-24T14:00"), null), lines.map { it.at })
    assertTrue(lines.none { it.text.contains("CANARY") || it.text.contains("401") || it.text.contains("71") || it.text.contains("57") })
  }

  @Test fun aDoseAlreadyMarkedIsNotNextAndTomorrowSaysSo() {
    val id = meds.meds.keys.single()
    meds.mark(DoseMark(id, at("2026-11-24T14:00"), Medicines.TAKEN, at("2026-11-24T13:30")))
    val lines = Briefing.build(Inputs(healthOn = true, source = StoreBriefingHealth(MemoryHealthStore(), meds)), now, zone)
    assertEquals(listOf("Medicine at 08:00 tomorrow"), lines.map { it.text })
  }

  @Test fun noStepsAndNoMedicinesIsNoHealthLine() {
    assertEquals(emptyList<BriefingLine>(), Briefing.build(Inputs(healthOn = true, source = StoreBriefingHealth(MemoryHealthStore(), MemoryMedicineStore())), now, zone))
  }

  @Test fun linesComeInKindOrderWithStableUniqueIds() {
    val inputs = Inputs(
      healthOn = true, source = StoreBriefingHealth(health, meds),
      dueList = listOf(DueThing(3, SuggestionKind.EVENT, at("2026-11-24T18:00")), DueThing(4, SuggestionKind.BILL, at("2026-11-24T20:00"))),
      txnList = listOf(txn(Direction.OUT, 100, at("2026-11-23T08:00"))),
      appLines = listOf(AppLine(BriefingKind.NEXUS, "2 things in Nexus today"), AppLine(BriefingKind.HOME, "Ali is home"), AppLine(BriefingKind.TASKS, "1 task is waiting for you"), AppLine(BriefingKind.CARDS, "1 card expires this month")),
    )
    val a = Briefing.build(inputs, now, zone)
    assertEquals(listOf("event", "bill", "spent", "medicine", "steps", "home", "cards", "tasks", "nexus"), a.map { it.kind })
    assertEquals(a, Briefing.build(inputs, now + 60_000, zone))
    assertEquals(a.size, a.map { it.lineId }.toSet().size)
    assertTrue(a.all { it.lineId in 1 until (1L shl 53) })
    assertEquals(listOf(0, 0, 1, 1, 1, 1, 0, 0, 0), a.map { it.sensitive })
  }

  @Test fun everyTextIsOneCleanLineOfAtMost80Characters() {
    val long = AppLine(BriefingKind.HOME, "Ali\nis home\u0000" + "x".repeat(200))
    val text = Briefing.build(Inputs(appLines = listOf(long)), now, zone).single().text
    assertEquals(80, text.length)
    assertTrue(text.startsWith("Ali is home x"))
    assertFalse(text.any { it.isISOControl() || it == ' ' })
  }

  @Test fun bothBriefingSettingsAreOffUntilTurnedOn() {
    assertFalse(Briefing.on(null))
    assertFalse(Briefing.on("0"))
    assertFalse(Briefing.on(""))
    assertTrue(Briefing.on("1"))
    assertTrue(Briefing.HEALTH_META != Briefing.SHARE_META)
  }

  @Test fun moneyIsGroupedAndShowsCentsOnlyWhenThereAreAny() {
    assertEquals("PKR 1,234,567", Briefing.money("PKR", 123_456_700))
    assertEquals("USD 0.05", Briefing.money("USD", 5))
  }
}
