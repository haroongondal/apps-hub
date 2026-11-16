package expo.modules.haloengine.core

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
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
  fun fixtureHasCases() = assertTrue(cases.size >= 8)

  @Test
  fun everyCaseDecodesToItsExpectedSettings() {
    for (c in cases) {
      val o = c.jsonObject
      val name = o["name"]!!.jsonPrimitive.content
      assertEquals(name, SettingsCodec.decode(o["expected"].toString()), SettingsCodec.decode(o["input"].toString()))
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
