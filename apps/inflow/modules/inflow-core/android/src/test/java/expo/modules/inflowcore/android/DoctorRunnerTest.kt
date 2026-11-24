package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.DoctorPayload
import expo.modules.inflowcore.core.HealthDay
import expo.modules.inflowcore.core.HttpReply
import expo.modules.inflowcore.core.JournalEntry
import expo.modules.inflowcore.core.Medicine
import expo.modules.inflowcore.core.MemoryHealthStore
import expo.modules.inflowcore.core.MemoryJournalStore
import expo.modules.inflowcore.core.MemoryMedicineStore
import java.net.SocketTimeoutException
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

  private class Call(val url: String, val headers: Map<String, String>, val body: String)
  private val calls = mutableListOf<Call>()
  private var replies = ArrayDeque(listOf(HttpReply(200, """{"choices":[{"message":{"content":"‮A plain summary.\u0000"}}],"usage":{"prompt_tokens":1000,"completion_tokens":200}}""")))
  private var throwOnPost: Exception? = null
  private var keys = listOf("gsk-groq-key")
  private var cap = false
  private val spent = mutableListOf<Double>()

  private val runner = DoctorRunner(
    { r, i -> DoctorPayload.load(r, i, health, meds, journal, at("2026-11-05T00:00"), zone) },
    { keys }, { cap }, { spent += it },
    { u, h, b -> calls += Call(u, h, b); throwOnPost?.let { throw it }; replies.removeFirst() },
  )
  private val stepsSleepHeart = mapOf("steps" to true, "sleep" to true, "heartRate" to true, "medicines" to false, "journal" to false)

  private fun preview() = runner.preview("2026-11-01", "2026-11-03", stepsSleepHeart)

  @Test fun oneRequestToGroqWithTheGroqKeyCarryingExactlyThePreview() {
    val p = preview()
    assertNull(p["error"])
    val text = p["text"] as String
    assertEquals(text.length, p["chars"])
    val out = runner.summarize("2026-11-01", "2026-11-03", stepsSleepHeart, p["hash"] as String)
    assertEquals(mapOf("summary" to "A plain summary.", "error" to null), out)
    val call = calls.single()
    assertEquals("https://api.groq.com/openai/v1/chat/completions", call.url)
    assertEquals("Bearer gsk-groq-key", call.headers["Authorization"])
    val body = Json.parseToJsonElement(call.body).jsonObject
    assertEquals(setOf("model", "messages", "max_tokens", "reasoning_effort"), body.keys)
    assertEquals("openai/gpt-oss-120b", body["model"]!!.jsonPrimitive.content)
    val messages = body["messages"]!!.jsonArray.map { it.jsonObject }
    assertEquals(listOf("system", "user"), messages.map { it["role"]!!.jsonPrimitive.content })
    assertEquals(DoctorPayload.SYSTEM, messages[0]["content"]!!.jsonPrimitive.content)
    assertEquals(text, messages[1]["content"]!!.jsonPrimitive.content)   // byte for byte what the owner saw
    assertTrue(text.contains("6123 steps"))
    for (canary in listOf("CANARY-MED", "CANARY-JOURNAL", "cough")) assertFalse(canary, call.body.contains(canary))
    assertTrue(spent.single() > 0)
  }

  @Test fun changedDataIsRefusedAndNothingIsSent() {
    val hash = preview()["hash"] as String
    health.rows["2026-11-02"] = health.rows["2026-11-02"]!!.copy(steps = 6124)
    assertEquals(DoctorRunner.CHANGED, runner.summarize("2026-11-01", "2026-11-03", stepsSleepHeart, hash)["error"])
    assertEquals(DoctorRunner.CHANGED, runner.summarize("2026-11-01", "2026-11-04", stepsSleepHeart, hash)["error"])
    assertTrue(calls.isEmpty())
  }

  @Test fun noGroqKeyOrTheDailyLimitSendsNothing() {
    val hash = preview()["hash"] as String
    keys = listOf(" ")
    assertEquals(mapOf("summary" to null, "error" to "Add a Groq key in AI settings first. Nothing was sent."), runner.summarize("2026-11-01", "2026-11-03", stepsSleepHeart, hash))
    keys = listOf("gsk-groq-key")
    cap = true
    assertEquals(DoctorRunner.CAP, runner.summarize("2026-11-01", "2026-11-03", stepsSleepHeart, hash)["error"])
    assertTrue(calls.isEmpty())
  }

  @Test fun badChoicesAreRefusedBeforeAnythingIsRead() {
    assertEquals("Pick at least one thing to include.", runner.preview("2026-11-01", "2026-11-03", emptyMap())["error"])
    assertEquals("Pick at most 90 days.", runner.summarize("2026-01-01", "2026-12-31", stepsSleepHeart, "x")["error"])
    assertNull(runner.preview("2026-11-03", "2026-11-01", stepsSleepHeart)["text"])
    assertTrue(calls.isEmpty())
  }

  @Test fun failuresComeBackInPlainWords() {
    val hash = preview()["hash"] as String
    throwOnPost = SocketTimeoutException("read")
    assertEquals("Groq took too long to answer. Try again.", runner.summarize("2026-11-01", "2026-11-03", stepsSleepHeart, hash)["error"])
    assertEquals(1, calls.size)
    throwOnPost = null
    replies = ArrayDeque(listOf(HttpReply(401, "{\"error\":\"echo gsk-groq-key\"}")))
    assertEquals("Groq refused your key. Check your Groq key in AI settings.", runner.summarize("2026-11-01", "2026-11-03", stepsSleepHeart, hash)["error"])
    replies = ArrayDeque(listOf(HttpReply(400, "{\"error\":\"context too long\"}")))
    assertEquals("Groq couldn't take this request. Try fewer days or fewer sections.", runner.summarize("2026-11-01", "2026-11-03", stepsSleepHeart, hash)["error"])
    replies = ArrayDeque(listOf(HttpReply(200, """{"choices":[{"message":{"content":"\u0000 "}}]}""")))
    assertEquals(DoctorRunner.EMPTY, runner.summarize("2026-11-01", "2026-11-03", stepsSleepHeart, hash)["error"])
    assertTrue(spent.isNotEmpty())
  }
}
