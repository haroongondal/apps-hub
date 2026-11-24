package expo.modules.haloengine.core

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LinkSharesTest {
  private fun fixture(name: String) = Json.parseToJsonElement(File("../fixtures/$name").readText()).jsonObject

  // A cursor gives Long for INTEGER, Double for REAL, String or null; JSON numbers map the same way here.
  private fun value(e: JsonElement): Any? = when {
    e is JsonNull -> null
    e is JsonPrimitive && e.isString -> e.content
    e is JsonPrimitive -> e.longOrNull ?: e.doubleOrNull ?: e.booleanOrNull
    else -> e.toString()
  }

  private fun rows(group: String, name: String): List<RawRow> =
    fixture("link-rows.sample.json")[group]?.jsonObject?.get(name)?.jsonArray.orEmpty().map { r -> r.jsonObject.mapValues { value(it.value) } }

  private fun parse(name: String, raw: List<RawRow>): Int = when (name) {
    "who_is_home" -> LinkShares.home(raw).size
    "new_devices" -> LinkShares.newDevices(raw).size
    "shield" -> listOfNotNull(LinkShares.shield(raw)).size
    "tunnel_health" -> listOfNotNull(LinkShares.lastSeenAt(raw, "open-tunnel")).size
    "deputy_waiting" -> LinkShares.deputyWaiting(raw).size
    "suggestions" -> LinkShares.suggestions(raw).size
    "briefing" -> LinkShares.briefing(raw).size
    else -> throw AssertionError("no reader for $name")
  }

  @Test fun everyReadShareEqualsTheFixtureBuiltFromTheShareDefinitions() {
    val f = fixture("link-shares.json")
    assertEquals(f.keys, LinkShares.ALL.map { it.name }.toSet())
    for (s in LinkShares.ALL) {
      val o = f.getValue(s.name).jsonObject
      assertEquals(s.name, o.getValue("authority").jsonPrimitive.content, s.authority)
      assertEquals(s.name, o.getValue("path").jsonPrimitive.content, s.path)
      assertEquals(s.name, o.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, s.columns)
      assertEquals(s.name, o.getValue("maxRows").jsonPrimitive.int, s.maxRows)
    }
  }

  @Test fun everyValidSampleRowIsRead() {
    for (s in LinkShares.ALL) {
      val raw = rows("valid", s.name)
      assertTrue(s.name, raw.isNotEmpty())
      assertEquals(s.name, if (s.maxRows == 1) 1 else raw.size, parse(s.name, raw))
    }
  }

  @Test fun everyInvalidOrBadFlagRowIsSkippedWithoutThrowing() {
    for (s in LinkShares.ALL) for (group in listOf("invalid", "badFlags")) assertEquals("${s.name} $group", 0, parse(s.name, rows(group, s.name)))
  }

  @Test fun sampleRowsReadAsTheirValues() {
    val shield = LinkShares.shield(rows("valid", "shield"))!!
    assertEquals(ShieldRow(on = true, untrustedNow = true, since = 1764000000000), shield)
    val waiting = LinkShares.deputyWaiting(rows("valid", "deputy_waiting"))
    assertEquals(listOf(1764003600000, null, 1764050000000), waiting.map { it.dueAt })
    val lines = LinkShares.briefing(rows("valid", "briefing"))
    assertEquals(listOf(true, true, false, false), lines.map { it.personal })
    assertEquals(1764000000000, LinkShares.lastSeenAt(rows("valid", "tunnel_health"), "open-tunnel"))
    assertNull(LinkShares.lastSeenAt(rows("valid", "tunnel_health"), "deputy"))
  }

  @Test fun extraColumnsAreIgnoredAndRowsPastMaxRowsAreNotRead() {
    val row = mapOf("on" to 1L, "untrusted_now" to 0L, "since" to 5L, "ssid" to "Home")
    assertEquals(ShieldRow(true, false, 5L), LinkShares.shield(listOf(row)))
    val many = List(300) { mapOf<String, Any?>("first_seen_at" to it.toLong(), "label" to "x", "acknowledged" to 0L) }
    assertEquals(LinkShares.NEW_DEVICES.maxRows, LinkShares.newDevices(many).size)
  }

  @Test fun numbersMustBeWholeAndSafe() {
    val ok = mapOf<String, Any?>("on" to 1.0, "untrusted_now" to 0L, "since" to 9007199254740991.0)
    assertEquals(ShieldRow(true, false, 9007199254740991L), LinkShares.shield(listOf(ok)))
    for (since in listOf<Any?>(1.5, Double.NaN, 9007199254740992L, "5", null)) {
      assertNull("$since", LinkShares.shield(listOf(ok + ("since" to since))))
    }
  }

  @Test fun textIsCleanedBeforeAnyScreenSeesIt() {
    assertEquals("Reply to Ali", LinkShares.clean("  Reply\nto\t‮Ali  "))
    assertNull(LinkShares.clean(" ​\u0000 "))
    assertEquals(LinkShares.MAX_TEXT, LinkShares.clean("x".repeat(200))!!.length)
    val split = "a".repeat(LinkShares.MAX_TEXT - 1) + "😀"
    assertEquals("a".repeat(LinkShares.MAX_TEXT - 1), LinkShares.clean(split))
    val s = LinkShares.suggestions(listOf(mapOf("id" to 1L, "kind" to "reply", "title" to "  ", "due_at" to null, "state" to "waiting", "created_at" to 1L, "expires_at" to 2L)))
    assertTrue(s.isEmpty())
  }
}
