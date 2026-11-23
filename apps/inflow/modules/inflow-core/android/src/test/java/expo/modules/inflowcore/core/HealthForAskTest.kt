package expo.modules.inflowcore.core

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// R10: the Ask answer request, built the way AiRunner.ask builds it, with health data present in every store.
class HealthForAskTest {
  private val zone = ZoneId.of("Asia/Karachi")
  private fun at(s: String) = LocalDateTime.parse(s).atZone(zone).toInstant().toEpochMilli()
  private val now = at("2026-11-14T10:30")
  private val from = at("2026-11-01T00:00")
  private val to = at("2026-11-14T23:59")

  private val health = MemoryHealthStore().apply {
    rows["2026-11-10"] = HealthDay("2026-11-10", 48_213, 401, 71, 57)
    rows["2026-10-01"] = HealthDay("2026-10-01", 11_111, null, null, null)
  }
  private val meds = MemoryMedicineStore().apply {
    val id = insert(Medicine(0, "CANARY-MEDICINE", "CANARY-DOSE", listOf(LocalTime.of(8, 0)), DayOfWeek.values().toSet(), LocalDate.parse("2026-11-01"), null, createdAt = at("2026-10-30T00:00")))
    mark(DoseMark(id, at("2026-11-10T08:00"), Medicines.TAKEN, at("2026-11-10T08:05")))
    mark(DoseMark(id, at("2026-11-11T08:00"), Medicines.SKIPPED, at("2026-11-11T08:05")))
  }
  private val journal = MemoryJournalStore().apply { insert(JournalEntry(0, at("2026-11-10T09:00"), 2, listOf("headache"), "CANARY-JOURNAL"), 0) }
  private val items = listOf(AskItem("Messages", "Bank", at("2026-11-10T12:00"), null, "You paid 500"))

  private fun requestBody(settingOn: Boolean): String {
    val h = HealthForAsk.context(settingOn, health, meds, from, to, now, zone)
    val bodies = mutableListOf<String>()
    val ok = HttpReply(200, """{"choices":[{"message":{"content":"ok"}}]}""")
    OpenAiCompatProvider("https://api.example.com/v1/", "m", listOf("k"), null, { _, _, b -> bodies += b; ok })
      .complete(Ask.answerSystem(h != null), Ask.answerUser("How did I sleep?", items, emptyList(), now, zone, h))
    return bodies.single()
  }

  private val today = run {
    val bodies = mutableListOf<String>()
    OpenAiCompatProvider("https://api.example.com/v1/", "m", listOf("k"), null, { _, _, b -> bodies += b; HttpReply(200, """{"choices":[{"message":{"content":"ok"}}]}""") })
      .complete(Ask.answerSystem(), Ask.answerUser("How did I sleep?", items, emptyList(), now, zone))
    bodies.single()
  }

  @Test fun offSendsNoHealthAndTheRequestIsByteIdenticalToBefore() {
    assertNull(HealthForAsk.context(false, health, meds, from, to, now, zone))
    val body = requestBody(false)
    assertEquals(today, body)
    for (canary in listOf("48213", "401", "CANARY", "Health", "medicine", "taken")) assertFalse(canary, body.contains(canary))
  }

  @Test fun onSendsOnlyAggregatesNeverJournalOrMedicineNames() {
    val body = requestBody(true)
    assertTrue(body, body.contains("2026-11-10: steps 48213, sleep 401 min, heart rate average 71, heart rate lowest 57"))
    assertTrue(body, body.contains("medicine 1: taken 1, skipped 1, missed 0"))
    assertTrue(body, body.contains("never diagnose"))
    for (canary in listOf("CANARY-JOURNAL", "headache", "CANARY-MEDICINE", "CANARY-DOSE", "11111")) assertFalse(canary, body.contains(canary))
  }

  @Test fun onCoversAtMost31DaysEndingWithThePlan() {
    val h = HealthForAsk.context(true, health, meds, at("2026-09-01T00:00"), to, now, zone)!!
    assertTrue(h.text, h.text.startsWith("Health from 2026-10-15 to 2026-11-14 "))
    assertFalse(h.text.contains("11111"))
    val empty = HealthForAsk.context(true, MemoryHealthStore(), MemoryMedicineStore(), from, to, now, zone)!!
    assertTrue(empty.text.endsWith("\nNo health data saved for these days."))
  }

  @Test fun theSettingIsOnOnlyWhenSavedAsOn() {
    assertFalse(HealthForAsk.on(null))
    assertFalse(HealthForAsk.on("0"))
    assertFalse(HealthForAsk.on("true"))
    assertTrue(HealthForAsk.on("1"))
  }
}
