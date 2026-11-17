package expo.modules.inflowcore.core

import java.time.Instant
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

class TxnCategorizeTest {
  private val karachi = ZoneId.of("Asia/Karachi")
  private val t0 = Instant.parse("2026-11-14T05:30:00Z").toEpochMilli()
  private val store = MemoryLedgerStore()

  private fun add(direction: Direction = Direction.OUT, amount: Long = 150_050, name: String? = "KFC", at: Long = t0, account: String = "Alfalah 2310"): Long =
    store.add(Parsed(direction, amount, "PKR", account, name, null), at, false)

  private fun txn(id: Long) = store.get(id)!!

  private fun reply(vararg entries: String) = """{"txns":[${entries.joinToString(",")}]}"""

  // ---- parse

  @Test fun parseKeepsOnlySentIds() {
    val a = add()
    val sent = listOf(txn(a))
    val r = TxnCategorize.Prompt.parse(reply("""{"id":$a,"category":"Groceries","name":"Imtiaz"}""", """{"id":999,"category":"Rent","name":"X"}"""), sent)
    assertEquals(mapOf(a to ("Groceries" to "Imtiaz")), r)
  }

  @Test fun parseDropsUnknownOrWrongDirectionCategories() {
    val out = add(Direction.OUT)
    val inn = add(Direction.IN, 200_000)
    val sent = listOf(txn(out), txn(inn))
    val r = TxnCategorize.Prompt.parse(
      reply("""{"id":$out,"category":"Salary","name":null}""", """{"id":$inn,"category":"Rent"}"""),
      sent,
    )
    assertTrue(r.isEmpty())
    val ok = TxnCategorize.Prompt.parse(reply("""{"id":$out,"category":"mobile & internet"}""", """{"id":$inn,"category":"SALARY"}"""), sent)
    assertEquals("Mobile & internet", ok.getValue(out).first)
    assertEquals("Salary", ok.getValue(inn).first)
  }

  @Test fun parseCleansNames() {
    val a = add()
    val long = "x".repeat(150)
    val r = TxnCategorize.Prompt.parse(reply("""{"id":$a,"category":"Fuel","name":"  Shell   Pump  "}"""), listOf(txn(a)))
    assertEquals("Shell Pump", r.getValue(a).second)
    val r2 = TxnCategorize.Prompt.parse(reply("""{"id":$a,"category":"Fuel","name":"$long"}"""), listOf(txn(a)))
    assertEquals(100, r2.getValue(a).second!!.length)
    val r3 = TxnCategorize.Prompt.parse(reply("""{"id":$a,"category":"Fuel","name":"   "}"""), listOf(txn(a)))
    assertNull(r3.getValue(a).second)
  }

  @Test fun parseSurvivesFencesAndProse() {
    val a = add()
    val body = reply("""{"id":$a,"category":"Health","name":"Dr Khan"}""")
    for (wrapped in listOf("```json\n$body\n```", "Here you go:\n$body\nDone.")) {
      assertEquals(mapOf(a to ("Health" to "Dr Khan")), TxnCategorize.Prompt.parse(wrapped, listOf(txn(a))))
    }
  }

  @Test fun parseNonJsonIsEmpty() {
    val a = add()
    for (bad in listOf("I cannot help.", "", """{"txns":"nope"}""", "[1,2]", """{"txns":[{"id":$a""")) {
      assertTrue(bad, TxnCategorize.Prompt.parse(bad, listOf(txn(a))).isEmpty())
    }
  }

  @Test fun parseDropsAnIdAnsweredTwice() {
    val a = add()
    val r = TxnCategorize.Prompt.parse(reply("""{"id":$a,"category":"Fuel"}""", """{"id":$a,"category":"Rent"}"""), listOf(txn(a)))
    assertTrue(r.isEmpty())
  }

  // ---- request

  @Test fun userHasOneLinePerTxnAndNoItemText() {
    val a = add(name = "KFC")
    val b = add(Direction.IN, 5_000_000, name = null, account = "UBL 1733")
    store.addSource(a, 77, Channel.SMS, null, t0)
    val u = TxnCategorize.Prompt.user(listOf(txn(a), txn(b)), karachi)
    assertFalse(u.contains("itemIds"))
    val lines = u.lines().filter { it.startsWith("{") }
    assertEquals(2, lines.size)
    val first = Json.parseToJsonElement(lines[0]).jsonObject
    assertEquals(a.toString(), first["id"]!!.jsonPrimitive.content)
    assertEquals("out", first["direction"]!!.jsonPrimitive.content)
    assertEquals("1500.50", first["amount"]!!.jsonPrimitive.content)
    assertEquals("PKR", first["currency"]!!.jsonPrimitive.content)
    assertEquals("Alfalah 2310", first["account"]!!.jsonPrimitive.content)
    assertEquals("KFC", first["name"]!!.jsonPrimitive.content)
    assertEquals("2026-11-14", first["date"]!!.jsonPrimitive.content)
    val second = Json.parseToJsonElement(lines[1]).jsonObject
    assertEquals("50000.00", second["amount"]!!.jsonPrimitive.content)
    assertFalse(second.containsKey("name"))
    assertTrue(TxnCategorize.Prompt.system().contains("\"txns\""))
    assertTrue((Categories.OUT + Categories.IN).all { TxnCategorize.Prompt.system().contains(it) })
  }

  // ---- run

  private var calls = 0
  private val sentIds = mutableListOf<List<Long>>()
  private var answer: (List<Long>) -> String = { ids -> reply(*ids.map { """{"id":$it,"category":"Groceries","name":"Shop"}""" }.toTypedArray()) }
  private var spent = 0
  private var cap = false

  private fun post(url: String, headers: Map<String, String>, body: String): HttpReply {
    calls++
    val user = Json.parseToJsonElement(body).jsonObject["messages"]!!.jsonArray[1].jsonObject["content"]!!.jsonPrimitive.content
    val ids = user.lines().filter { it.startsWith("{") }.map { Json.parseToJsonElement(it).jsonObject["id"]!!.jsonPrimitive.content.toLong() }
    sentIds += ids
    val content = Json.encodeToString(kotlinx.serialization.serializer<String>(), answer(ids))
    return HttpReply(200, """{"choices":[{"message":{"role":"assistant","content":$content}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}""")
  }

  private val provider = OpenAiCompatProvider("https://x.example/v1", "m", listOf("k"), null, ::post, {})

  private fun run(max: Int = 5, hasProvider: Boolean = true) =
    TxnCategorize(store, { if (hasProvider) provider else null }, { spent++ }, { cap }, karachi).run(max)

  @Test fun runCategorisesAndSpends() {
    val ids = (1..3).map { add(amount = it * 100L, at = t0 + it) }
    assertEquals(3, run())
    ids.forEach { assertEquals("Groceries", txn(it).category); assertEquals("Shop", txn(it).label) }
    assertEquals(1, calls)
    assertEquals(1, spent)
    assertEquals(0, run())   // nothing left, no call
    assertEquals(1, calls)
  }

  @Test fun runBatchesOf100NewestFirst() {
    val ids = (1..130).map { add(amount = it * 100L, at = t0 + it) }
    assertEquals(130, run())
    assertEquals(2, calls)
    assertEquals(100, sentIds[0].size)
    assertEquals(ids.last(), sentIds[0].first())   // newest first
    assertEquals(30, sentIds[1].size)
  }

  @Test fun runStopsAtMaxBatches() {
    (1..250).forEach { add(amount = it * 100L, at = t0 + it) }
    assertEquals(200, run(max = 2))
    assertEquals(2, calls)
  }

  @Test fun runStopsWhenCapReached() {
    add()
    cap = true
    assertEquals(0, run())
    assertEquals(0, calls)
    assertNull(txn(1).category)
  }

  @Test fun runWithoutProviderDoesNothing() {
    add()
    assertEquals(0, run(hasProvider = false))
    assertEquals(0, calls)
  }

  @Test fun omittedIdIsTriedAgainThenGivenUpAfterThree() {
    val a = add(at = t0 + 1)
    val b = add(at = t0 + 2)
    answer = { _ -> reply("""{"id":$a,"category":"Fuel","name":null}""") }   // b is never answered
    assertEquals(1, run())
    assertEquals("Fuel", txn(a).category)
    assertNull(txn(b).category)
    assertEquals(1, store.tries[b])
    assertNull(store.tries[a])
    assertEquals(0, run())
    assertEquals(0, run())
    assertEquals(3, store.tries[b])
    val before = calls
    assertEquals(0, run())   // no longer fetched: no call
    assertEquals(before, calls)
  }

  @Test fun ownerSetCategoryIsNotFetchedOrChanged() {
    val a = add()
    store.setCategory(a, "Rent")
    assertEquals(0, run())
    assertEquals(0, calls)
    assertEquals("Rent", txn(a).category)
  }

  @Test fun anInvalidCategoryIsDroppedAndCountsATry() {
    val a = add()
    answer = { _ -> reply("""{"id":$a,"category":"Gambling","name":"X"}""") }
    assertEquals(0, run())
    assertNull(txn(a).category)
    assertEquals(1, store.tries[a])
  }

  @Test fun aRefusedRequestStopsTheRunWithoutCountingATry() {
    val a = add()
    val refusing = OpenAiCompatProvider("https://x.example/v1", "m", listOf("k"), null, { _, _, _ -> HttpReply(400, "bad model") }, {})
    assertEquals(0, TxnCategorize(store, { refusing }, { spent++ }, { false }, karachi).run())
    assertNull(store.tries[a])
    assertNull(txn(a).category)
  }

  @Test fun aTimeoutKeepsTheTxnsForLater() {
    val a = add()
    val slow = OpenAiCompatProvider("https://x.example/v1", "m", listOf("k"), null, { _, _, _ -> throw java.net.SocketTimeoutException("Read timed out") }, {})
    assertEquals(0, TxnCategorize(store, { slow }, { spent++ }, { false }, karachi).run())
    assertNull(store.tries[a])
  }

  @Test fun anApiErrorKeepsTheTxnsForLater() {
    val a = add()
    val failing = OpenAiCompatProvider("https://x.example/v1", "m", listOf("k"), null, { _, _, _ -> HttpReply(401, "no") }, {})
    assertEquals(0, TxnCategorize(store, { failing }, { spent++ }, { false }, karachi).run())
    assertNull(store.tries[a])
    assertNull(txn(a).category)
  }
}
