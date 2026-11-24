package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.DoctorPayload
import expo.modules.inflowcore.core.HealthDay
import expo.modules.aihubclient.core.Kinds
import expo.modules.inflowcore.core.AiPricing
import expo.modules.inflowcore.core.FakeHub
import expo.modules.inflowcore.core.HubCopy
import expo.modules.inflowcore.core.JournalEntry
import expo.modules.inflowcore.core.Medicine
import expo.modules.inflowcore.core.MemoryHealthStore
import expo.modules.inflowcore.core.MemoryJournalStore
import expo.modules.inflowcore.core.MemoryMedicineStore
import expo.modules.inflowcore.core.Usage
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DoctorRunnerTest {
  private val zone = ZoneId.of("Asia/Karachi")
  private fun at(s: String) = LocalDateTime.parse(s).atZone(zone).toInstant().toEpochMilli()

  private val health = MemoryHealthStore().apply { rows["2026-11-02"] = HealthDay("2026-11-02", 6123, 380, 70, 55) }
  private val meds = MemoryMedicineStore().apply {
    insert(Medicine(0, "CANARY-MED", "1 tablet", listOf(LocalTime.of(8, 0)), DayOfWeek.values().toSet(), LocalDate.parse("2026-11-01"), null, createdAt = at("2026-10-01T00:00")))
  }
  private val journal = MemoryJournalStore().apply { insert(JournalEntry(0, at("2026-11-02T09:00"), 2, listOf("cough"), "CANARY-JOURNAL"), 0) }

  private val requests = mutableListOf<String>()
  private var hub: () -> String = { FakeHub.reply("\u202EA plain summary.\u0000", Usage(1000, 0, 200)) }
  private var cap = false
  private val spent = mutableListOf<Double>()

  private val runner = DoctorRunner(
    { r, i -> DoctorPayload.load(r, i, health, meds, journal, at("2026-11-05T00:00"), zone) },
    FakeHub.ai(foreground = true) { requests += it; hub() }, { cap }, { spent += AiPricing.cost(it) },
  )
  private val stepsSleepHeart = mapOf("steps" to true, "sleep" to true, "heartRate" to true, "medicines" to false, "journal" to false)

  private fun preview() = runner.preview("2026-11-01", "2026-11-03", stepsSleepHeart)

  @Test fun oneRequestToTheHubCarryingExactlyThePreview() {
    val p = preview()
    assertNull(p["error"])
    val text = p["text"] as String
    assertEquals(text.length, p["chars"])
    val out = runner.summarize("2026-11-01", "2026-11-03", stepsSleepHeart, p["hash"] as String)
    assertEquals(mapOf("summary" to "A plain summary.", "error" to null), out)
    val call = requests.single()
    val body = Json.parseToJsonElement(call).jsonObject
    assertEquals(setOf("apiVersion", "requestId", "job", "priority", "messages", "maxTokens"), body.keys)
    assertEquals("chat", body["job"]!!.jsonPrimitive.content)
    assertEquals("foreground", body["priority"]!!.jsonPrimitive.content)
    val messages = body["messages"]!!.jsonArray.map { it.jsonObject }
    assertEquals(listOf("system", "user"), messages.map { it["role"]!!.jsonPrimitive.content })
    assertEquals(DoctorPayload.SYSTEM, messages[0]["content"]!!.jsonPrimitive.content)
    assertEquals(text, messages[1]["content"]!!.jsonPrimitive.content)   // byte for byte what the owner saw
    assertTrue(text.contains("6123 steps"))
    for (canary in listOf("CANARY-MED", "CANARY-JOURNAL", "cough")) assertFalse(canary, call.contains(canary))
    assertTrue(spent.single() > 0)
  }

  @Test fun changedDataIsRefusedAndNothingIsSent() {
    val hash = preview()["hash"] as String
    health.rows["2026-11-02"] = health.rows["2026-11-02"]!!.copy(steps = 6124)
    assertEquals(DoctorRunner.CHANGED, runner.summarize("2026-11-01", "2026-11-03", stepsSleepHeart, hash)["error"])
    assertEquals(DoctorRunner.CHANGED, runner.summarize("2026-11-01", "2026-11-04", stepsSleepHeart, hash)["error"])
    assertTrue(requests.isEmpty())
  }

  @Test fun theDailyLimitSendsNothing() {
    val hash = preview()["hash"] as String
    cap = true
    assertEquals(DoctorRunner.CAP, runner.summarize("2026-11-01", "2026-11-03", stepsSleepHeart, hash)["error"])
    assertTrue(requests.isEmpty())
  }

  @Test fun badChoicesAreRefusedBeforeAnythingIsRead() {
    assertEquals("Pick at least one thing to include.", runner.preview("2026-11-01", "2026-11-03", emptyMap())["error"])
    assertEquals("Pick at most 90 days.", runner.summarize("2026-01-01", "2026-12-31", stepsSleepHeart, "x")["error"])
    assertNull(runner.preview("2026-11-03", "2026-11-01", stepsSleepHeart)["text"])
    assertTrue(requests.isEmpty())
  }

  @Test fun failuresComeBackInPlainWords() {
    val hash = preview()["hash"] as String
    fun error() = runner.summarize("2026-11-01", "2026-11-03", stepsSleepHeart, hash)["error"]
    hub = { FakeHub.fail(Kinds.TIMEOUT) }
    assertEquals("The AI took too long to answer. Try again.", error())
    assertEquals(1, requests.size)
    hub = { FakeHub.fail(Kinds.HUB_MISSING) }
    assertEquals(HubCopy.MISSING, error())
    hub = { FakeHub.fail(Kinds.NOT_ALLOWED) }
    assertEquals(HubCopy.NOT_ALLOWED, error())
    hub = { FakeHub.fail(Kinds.NO_KEY) }
    assertEquals(HubCopy.NO_KEY, error())
    hub = { FakeHub.fail(Kinds.TOO_LARGE) }
    assertEquals("AI hub couldn't take this request. Try fewer days or fewer sections.", error())
    hub = { FakeHub.fail(Kinds.PROVIDER) }
    assertEquals(HubCopy.FAILED, error())
    hub = { FakeHub.reply("\u0000 ") }
    assertEquals(DoctorRunner.EMPTY, error())
    assertTrue(spent.isNotEmpty())
  }
}
