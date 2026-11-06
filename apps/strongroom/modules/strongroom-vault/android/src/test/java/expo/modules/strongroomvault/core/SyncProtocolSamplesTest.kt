package expo.modules.strongroomvault.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncProtocolSamplesTest {
  private val samples = Json.parseToJsonElement(javaClass.classLoader!!.getResource("sync-samples.json")!!.readText()).jsonObject

  private fun request(name: String) = samples.getValue(name).jsonObject.getValue("request").jsonObject.getValue("body").jsonObject

  private fun reply(name: String) = samples.getValue(name).jsonObject.getValue("response").jsonObject.let {
    it.getValue("status").jsonPrimitive.int to it.getValue("body").toString()
  }

  private fun JsonObject.text(key: String) = getValue(key).jsonPrimitive.content

  private fun parse(json: String): JsonElement = Json.parseToJsonElement(json)

  @Test fun parsesEverySampleFromTheWorker() {
    assertEquals(
      setOf("accountCreate", "prelogin", "push", "pull", "pushConflict", "accountUpdate", "accountUpdateKeepRecovery"),
      samples.keys,
    )

    val create = request("accountCreate")
    assertEquals(create, parse(SyncWire.toJson(AccountCreate(create.text("header"), create.text("loginHash"), create.text("recoveryHash"), create.text("readHash")))))
    for (name in listOf("accountUpdate", "accountUpdateKeepRecovery")) {
      val u = request(name)
      val update = AccountUpdate(u.text("header"), u.text("loginHash"), u.text("readHash"), u.getValue("ifRev").jsonPrimitive.long, u["recoveryHash"]?.jsonPrimitive?.content)
      assertEquals(name, u, parse(SyncWire.toJson(update)))
    }
    assertFalse("recoveryHash" in request("accountUpdateKeepRecovery"))
    for (name in listOf("accountCreate", "accountUpdate", "accountUpdateKeepRecovery")) {
      val h = request(name).text("header")
      assertEquals(name, h, Header.fromJson(h)!!.toJson())
    }
    for (name in listOf("push", "pushConflict")) {
      val upserts = request(name).getValue("upserts").jsonArray.map { it.jsonObject }
      val req = PushRequest(upserts.map { Upsert(it.text("id"), it.getValue("baseRev").jsonPrimitive.long, it.text("ciphertext")) })
      assertEquals(name, request(name), parse(SyncWire.toJson(req)))
    }

    val pre = reply("prelogin").let { (s, b) -> SyncWire.prelogin(s, b) }
    assertEquals(Prelogin(KdfParams(65536, 3, 1), "AAECAwQFBgcICQoLDA0ODw==", true), pre)

    val pull = reply("pull").let { (s, b) -> SyncWire.pull(s, b) }
    assertNotNull(Header.fromJson(pull.header))
    assertEquals(listOf(1L, 2L, false), listOf(pull.headerRev, pull.latestRev, pull.more))
    assertEquals(
      listOf(Triple(id(1), 1L, "c2VhbGVkIHJlY29yZCBvbmU="), Triple(id(2), 2L, "c2VhbGVkIHJlY29yZCB0d28=")),
      pull.records.map { Triple(it.id, it.rev, it.ciphertext) },
    )

    val pushed = reply("push").let { (s, b) -> SyncWire.push(s, b) } as PushResponse
    assertEquals(listOf(id(1) to 1L, id(2) to 2L), pushed.revs)
    assertEquals(2L, pushed.latestRev)
    val conflict = reply("pushConflict").let { (s, b) -> SyncWire.push(s, b) } as PushConflict
    assertEquals(listOf(id(1) to 1L), conflict.conflicts)

    for ((name, rev) in listOf("accountCreate" to 1L, "accountUpdate" to 2L, "accountUpdateKeepRecovery" to 3L)) {
      assertEquals(name, rev, reply(name).let { (s, b) -> SyncWire.account(s, b) })
    }
  }

  private val page = """{"header":"{}","headerRev":1,"records":[],"latestRev":0,"more":false}"""
  private val goodPrelogin = """{"version":1,"kdf":{"memoryKiB":65536,"iterations":3,"parallelism":1},"salt":"AAECAwQFBgcICQoLDA0ODw==","accountKey":true}"""

  private fun refused(status: Int, call: () -> Unit) {
    val e = assertThrows(SyncHttpError::class.java) { call() }
    assertFalse(e is SyncAuthError)
    assertEquals(status, e.status)
  }

  @Test fun failuresAreMapped() {
    assertNull(SyncWire.prelogin(404, """{"error":"none"}"""))
    assertThrows(SyncAuthError::class.java) { SyncWire.pull(401, """{"error":"no"}""") }
    assertThrows(SyncAuthError::class.java) { SyncWire.push(401, "not json") }
    refused(500) { SyncWire.pull(500, """{"error":"boom"}""") }
    refused(413) { SyncWire.push(413, """{"error":"big"}""") }
    refused(200) { SyncWire.pull(200, "not json") }
    refused(404) { SyncWire.prelogin(404, "not json") }
    assertEquals(2L, SyncWire.account(200, """{"headerRev":2}"""))
  }

  @Test fun malformedServerBodiesAreRefused() {
    val bad = listOf("null", "[]", "{}", page.replace("[]", "\"none\""), page.replace("[]", "[null]"), page.replace("false", "1"), page.replace("\"{}\"", "3"))
    for (body in bad) refused(200) { SyncWire.pull(200, body) }
    refused(200) { SyncWire.pull(200, page.replace("\"headerRev\":1", "\"headerRev\":9007199254740992")) }
    for (body in listOf("""{"latestRev":1}""", """{"revs":[null],"latestRev":1}""", """{"revs":[],"latestRev":"1"}""")) {
      refused(200) { SyncWire.push(200, body) }
    }
    for (body in listOf("""{"error":"stale"}""", """{"conflicts":"x"}""")) refused(409) { SyncWire.push(409, body) }
    refused(200) { SyncWire.prelogin(200, """{"kdf":null,"salt":"s","accountKey":true}""") }
    refused(200) { SyncWire.prelogin(200, """{"version":1,"kdf":{},"salt":"s"}""") }
    refused(200) { SyncWire.prelogin(200, goodPrelogin.replace("65536", "\"65536\"")) }
    assertEquals(Prelogin(KdfParams(65536, 3, 1), "AAECAwQFBgcICQoLDA0ODw==", true), SyncWire.prelogin(200, goodPrelogin))
    for (salt in listOf("\"not*base64*salt*here*!==\"", "\"AAECAwQFBgc=\"", "\"AAECAwQFBgcICQoLDA0ODw\"", "\"AAECAwQFBgcICQoLDA0ODxAR\"", "[\"AAECAwQFBgcICQoLDA0ODw==\"]")) {
      refused(200) { SyncWire.prelogin(200, goodPrelogin.replace("\"AAECAwQFBgcICQoLDA0ODw==\"", salt)) }
    }
    refused(200) { SyncWire.account(200, """{"headerRev":"2"}""") }
    refused(200) { SyncWire.pull(200, page.replace("[]", "[" + "[".repeat(100_000) + "]".repeat(100_000) + "]")) }

    val rows = SyncWire.pull(200, page.replace("[]", """[{"id":7,"rev":"2","ciphertext":null},{}]""")).records
    assertTrue(rows.all { it.id == null && it.rev == null && it.ciphertext == null })
  }
}
