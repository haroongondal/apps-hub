package expo.modules.haloengine.core

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsTest {
  // Gradle runs unit tests with the module's android/ folder as working directory.
  private val cases: JsonArray =
    Json.parseToJsonElement(File("../fixtures/settings.cases.json").readText()) as JsonArray

  @Test
  fun fixtureHasCases() = assertTrue(cases.size >= 30)

  // Checks Kotlin against the fixture's literal values, so a default or clamp that drifts from TypeScript fails here.
  @Test
  fun everyCaseDecodesToItsExpectedSettings() {
    for (c in cases) {
      val o = c.jsonObject
      val name = o["name"]!!.jsonPrimitive.content
      val s = SettingsCodec.decode(o["input"].toString())
      val e = o["expected"]!!.jsonObject
      fun JsonObject.b(k: String) = this[k]!!.jsonPrimitive.boolean
      fun JsonObject.d(k: String) = this[k]!!.jsonPrimitive.double
      fun JsonObject.str(k: String) = this[k]!!.jsonPrimitive.content
      fun JsonObject.nums(k: String) = this[k]!!.jsonArray.map { it.jsonPrimitive.double }
      assertEquals("$name enabled", e.b("enabled"), s.enabled)
      assertEquals("$name pattern", e.str("pattern"), s.pattern)
      val p = e["params"]!!.jsonObject
      val params = mapOf(
        "thickness" to s.params.thickness, "speed" to s.params.speed, "spread" to s.params.spread,
        "glow" to s.params.glow, "padding" to s.params.padding, "roundness" to s.params.roundness,
      )
      for ((k, v) in params) assertEquals("$name params.$k", p.d(k), v, 0.0)
      assertEquals("$name params.mirrored", p.b("mirrored"), s.params.mirrored)
      assertEquals("$name params.clockwise", p.b("clockwise"), s.params.clockwise)
      val col = e["colors"]!!.jsonObject
      assertEquals("$name colors.source", col.str("source"), s.colors.source.key)
      assertEquals("$name colors.palette", col["palette"]!!.jsonArray.map { it.jsonPrimitive.content }, s.colors.palette)
      val ed = e["edges"]!!.jsonObject
      assertEquals("$name edges.auto", ed.b("auto"), s.edges.auto)
      assertEquals("$name edges.corners", ed.nums("corners"), s.edges.corners.map { it.toDouble() })
      assertEquals("$name edges.insets", ed.nums("insets"), s.edges.insets.map { it.toDouble() })
      val n = e["notify"]!!.jsonObject
      val sn = s.notify
      assertEquals("$name notify.enabled", n.b("enabled"), sn.enabled)
      assertEquals("$name notify.defaultOn", n.b("defaultOn"), sn.defaultOn)
      assertEquals("$name notify.style", n.str("style"), sn.style)
      assertEquals("$name notify.repeat", n.d("repeat"), sn.repeat.toDouble(), 0.0)
      assertEquals("$name notify.durationMs", n.d("durationMs"), sn.durationMs.toDouble(), 0.0)
      assertEquals("$name notify.reminderMin", n["reminderMin"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.double }, sn.reminderMin?.toDouble())
      assertEquals("$name notify.wakeScreen", n.b("wakeScreen"), sn.wakeScreen)
      val apps = n["apps"]!!.jsonObject
      assertEquals("$name notify.apps keys", apps.keys.toList(), sn.apps.keys.toList())
      for ((pkg, v) in apps) {
        val a = v.jsonObject
        assertEquals("$name notify.apps.$pkg.on", a.b("on"), sn.apps[pkg]!!.on)
        assertEquals("$name notify.apps.$pkg.colour", a["colour"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }, sn.apps[pkg]!!.colour)
      }
      val q = n["quiet"]!!.jsonObject
      assertEquals("$name notify.quiet.on", q.b("on"), sn.quiet.on)
      assertEquals("$name notify.quiet.start", q.str("start"), sn.quiet.start)
      assertEquals("$name notify.quiet.end", q.str("end"), sn.quiet.end)
      val r = e["rules"]!!.jsonObject
      val sr = s.rules
      assertEquals("$name rules.apps", r["apps"]!!.jsonArray.map { it.jsonPrimitive.content }, sr.apps)
      assertEquals("$name rules.fullscreen", r.b("fullscreen"), sr.fullscreen)
      assertEquals("$name rules.landscape", r.b("landscape"), sr.landscape)
      assertEquals("$name rules.calls", r.b("calls"), sr.calls)
      assertEquals("$name rules.batterySaver", r.b("batterySaver"), sr.batterySaver)
      assertEquals("$name rules.pocket", r.b("pocket"), sr.pocket)
    }
  }

  @Test
  fun everyCaseRoundTrips() {
    for (c in cases) {
      val s = SettingsCodec.decode(c.jsonObject["input"].toString())
      assertEquals(c.jsonObject["name"].toString(), s, SettingsCodec.decode(SettingsCodec.encode(s)))
    }
  }

  @Test
  fun garbageGivesDefaultsWithoutThrowing() {
    for (x in listOf("", "not json", "null", "[]", "5", "\"x\"", "{")) assertEquals(x, Settings(), SettingsCodec.decode(x))
  }

  @Test
  fun encodeWritesVersionOne() {
    assertEquals(1, Json.parseToJsonElement(SettingsCodec.encode(Settings())).jsonObject["version"]!!.jsonPrimitive.content.toInt())
  }
}
