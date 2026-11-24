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
  fun fixtureHasCases() = assertTrue(cases.size >= 60)

  // Checks Kotlin against the fixture's literal values, so a default or clamp that drifts from TypeScript fails here.
  @Test
  fun everyCaseDecodesToItsExpectedSettings() {
    for (c in cases) {
      val o = c.jsonObject
      val name = o["name"]!!.jsonPrimitive.content
      val s = SettingsCodec.decode(o["input"].toString())
      val e = o["expected"]!!.jsonObject
      fun JsonObject.nums(k: String) = this[k]!!.jsonArray.map { it.jsonPrimitive.double }
      assertEquals("$name enabled", e.b("enabled"), s.enabled)
      val l = e["links"]!!.jsonObject
      val links = mapOf(
        "shieldPulse" to s.links.shieldPulse, "waitingPulse" to s.links.waitingPulse, "waitingAod" to s.links.waitingAod,
        "bubble" to s.links.bubble, "briefing" to s.links.briefing, "briefingPrivate" to s.links.briefingPrivate,
      )
      assertEquals("$name links keys", l.keys, links.keys)
      for ((k, v) in links) assertEquals("$name links.$k", l.b(k), v)
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
        assertEquals("$name notify.apps.$pkg.style", a["style"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }, sn.apps[pkg]!!.style)
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
      checkAod(name, e["aod"]!!.jsonObject, s.aod)
      checkThemes(name, e["themes"]!!.jsonArray, s.themes)
    }
  }

  private fun JsonObject.b(k: String) = this[k]!!.jsonPrimitive.boolean
  private fun JsonObject.d(k: String) = this[k]!!.jsonPrimitive.double
  private fun JsonObject.str(k: String) = this[k]!!.jsonPrimitive.content

  private fun checkAod(name: String, a: JsonObject, s: SettingsAod) {
    assertEquals("$name aod.enabled", a.b("enabled"), s.enabled)
    assertEquals("$name aod.timeoutSec", a["timeoutSec"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.double }, s.timeoutSec?.toDouble())
    assertEquals("$name aod.trigger", a.str("trigger"), s.trigger.key)
    val sc = a["schedule"]!!.jsonObject
    assertEquals("$name aod.schedule.on", sc.b("on"), s.schedule.on)
    assertEquals("$name aod.schedule.start", sc.str("start"), s.schedule.start)
    assertEquals("$name aod.schedule.end", sc.str("end"), s.schedule.end)
    assertEquals("$name aod.themeId", a.str("themeId"), s.themeId)
    assertEquals("$name aod.slots", a["slots"]!!.jsonArray.map { it.jsonObject.str("start") to it.jsonObject.str("themeId") }, s.slots.map { it.start to it.themeId })
    val dots = a["dots"]!!.jsonObject
    assertEquals("$name aod.dots.on", dots.b("on"), s.dots.on)
    assertEquals("$name aod.dots.count", dots.b("count"), s.dots.count)
    val kinds = dots["kinds"]!!.jsonObject
    assertEquals("$name aod.dots.kinds keys", DotKind.entries.map { it.key }.toSet(), kinds.keys)
    for (k in DotKind.entries) assertEquals("$name aod.dots.kinds.${k.key}", kinds.b(k.key), k in s.dots.kinds)
    assertEquals("$name aod.chargeEffect", a.str("chargeEffect"), s.chargeEffect.key)
    assertEquals("$name aod.wakeOnCharge", a.b("wakeOnCharge"), s.wakeOnCharge)
  }

  private fun checkThemes(name: String, expected: JsonArray, themes: List<Theme>) {
    assertEquals("$name themes ids", expected.map { it.jsonObject.str("id") }, themes.map { it.id })
    for ((i, te) in expected.withIndex()) {
      val t = te.jsonObject
      val s = themes[i]
      val w = "$name theme ${s.id}"
      assertEquals("$w name", t.str("name"), s.name)
      assertEquals("$w face", t.str("face"), s.face)
      val f = t["faceOptions"]!!.jsonObject
      assertEquals("$w faceOptions.size", f.str("size"), s.faceOptions.size)
      assertEquals("$w faceOptions.position", f.str("position"), s.faceOptions.position)
      assertEquals("$w faceOptions.h24", f.b("h24"), s.faceOptions.h24)
      assertEquals("$w faceOptions.date", f.b("date"), s.faceOptions.date)
      assertEquals("$w faceOptions.battery", f.b("battery"), s.faceOptions.battery)
      assertEquals("$w faceOptions.alarm", f.b("alarm"), s.faceOptions.alarm)
      assertEquals("$w faceOptions.seconds", f.b("seconds"), s.faceOptions.seconds)
      val c = t["colours"]!!.jsonObject
      assertEquals("$w colours.source", c.str("source"), s.colours.source.key)
      assertEquals("$w colours.palette", c["palette"]!!.jsonArray.map { it.jsonPrimitive.content }, s.colours.palette)
      assertEquals("$w photo", t.b("photo"), s.photo)
      assertEquals("$w dim", t.d("dim"), s.dim, 0.0)
      val e = t["edge"]!!.jsonObject
      assertEquals("$w edge.on", e.b("on"), s.edge.on)
      assertEquals("$w edge.pattern", e.str("pattern"), s.edge.pattern)
      assertEquals("$w brightness", t.d("brightness"), s.brightness, 0.0)
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
  fun nanAndInfinityFallBackToTheDefaults() {
    val s = SettingsCodec.decode("""{"params":{"thickness":NaN,"speed":Infinity,"glow":-Infinity},"themes":[{"id":"x","dim":NaN,"brightness":Infinity}]}""")
    val d = Settings()
    assertEquals(d.params.thickness, s.params.thickness, 0.0)
    assertEquals(d.params.speed, s.params.speed, 0.0)
    assertEquals(d.params.glow, s.params.glow, 0.0)
    assertEquals(0.5, s.themes[0].dim, 0.0)
    assertEquals(0.02, s.themes[0].brightness, 0.0)
  }

  @Test
  fun serviceWantedIfLightsAodOrNotificationsAreOn() {
    val off = Settings(enabled = false, notify = SettingsNotify(enabled = false))
    assertTrue(!off.serviceWanted)
    assertTrue(off.copy(enabled = true).serviceWanted)
    assertTrue(off.copy(aod = SettingsAod(enabled = true)).serviceWanted)
    assertTrue(off.copy(notify = SettingsNotify(enabled = true)).serviceWanted)
    assertTrue(off.copy(links = SettingsLinks(shieldPulse = true)).serviceWanted)
    assertTrue(off.copy(links = SettingsLinks(waitingPulse = true)).serviceWanted)
    assertTrue(off.copy(links = SettingsLinks(bubble = true)).serviceWanted)
    // The always-on rows need the always-on screen, which already wants the service.
    assertTrue(!off.copy(links = SettingsLinks(waitingAod = true, briefing = true, briefingPrivate = true)).serviceWanted)
  }

  @Test
  fun encodeWritesVersionOne() {
    assertEquals(1, Json.parseToJsonElement(SettingsCodec.encode(Settings())).jsonObject["version"]!!.jsonPrimitive.content.toInt())
  }
}
