package expo.modules.netlenscore.applink

import expo.modules.netlenscore.applink.AppLinkGuard.ExtraSpec
import expo.modules.netlenscore.applink.AppLinkGuard.ExtraType
import expo.modules.netlenscore.applink.AppLinkGuard.ExtrasCheck
import expo.modules.netlenscore.applink.AppLinkGuard.Reason
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppLinkGuardTest {
  // Gradle runs module unit tests from the module's android/ folder: five levels up is the repo root.
  private fun fixture(name: String): String {
    val f = File("../../../../../packages/app-link-contract/fixtures/$name")
    assertTrue("fixture not found from ${File(".").absoluteFile}", f.isFile)
    return f.readText()
  }

  private fun reason(s: String) = when (s) {
    "self" -> Reason.SELF
    "ok" -> Reason.OK
    "no-permission" -> Reason.NO_PERMISSION
    "signature-mismatch" -> Reason.SIGNATURE_MISMATCH
    else -> throw AssertionError("unknown reason $s")
  }

  @Test fun decideEqualsEveryFixtureRow() {
    val rows = Json.parseToJsonElement(fixture("caller-decisions.json")).jsonArray
    assertEquals(8, rows.size)
    for (r in rows.map { it.jsonObject }) {
      val d = AppLinkGuard.decide(r.getValue("isSelf").jsonPrimitive.boolean, r.getValue("holdsPermission").jsonPrimitive.boolean, r.getValue("signatureMatches").jsonPrimitive.boolean)
      assertEquals("$r", r.getValue("allow").jsonPrimitive.boolean, d.allow)
      assertEquals("$r", reason(r.getValue("reason").jsonPrimitive.content), d.reason)
    }
  }

  @Test fun aCallerThatIsNotASignedSiblingIsRefused() {
    assertEquals(AppLinkGuard.Decision(false, Reason.NO_PERMISSION), AppLinkGuard.decide(false, false, false))
    assertEquals(AppLinkGuard.Decision(false, Reason.SIGNATURE_MISMATCH), AppLinkGuard.decide(false, true, false))
  }

  @Test fun thePermissionIsTheOneTheManifestDeclares() = assertEquals("com.haroon.permission.AUTOPILOT", AppLinkGuard.PERMISSION)

  @Test fun theLimitsEqualTheSharedFixture() {
    val l = Json.parseToJsonElement(fixture("limits.json")).jsonObject.mapValues { it.value.jsonPrimitive.int }
    assertEquals(
      mapOf(
        "MAX_EXTRAS" to AppLinkGuard.MAX_EXTRAS,
        "MAX_STRING_CHARS" to AppLinkGuard.MAX_STRING_CHARS,
        "MAX_ARRAY_ITEMS" to AppLinkGuard.MAX_ARRAY_ITEMS,
        "MAX_ARRAY_ITEM_CHARS" to AppLinkGuard.MAX_ARRAY_ITEM_CHARS,
        "MAX_TOTAL_CHARS" to AppLinkGuard.MAX_TOTAL_CHARS,
        "MAX_RESULT_MESSAGE_CHARS" to AppLinkGuard.MAX_RESULT_MESSAGE_CHARS,
      ),
      l,
    )
  }

  private val spec = mapOf(
    "text" to ExtraSpec(ExtraType.STRING, required = true),
    "short" to ExtraSpec(ExtraType.STRING, max = 5),
    "id" to ExtraSpec(ExtraType.LONG),
    "flag" to ExtraSpec(ExtraType.BOOLEAN),
    "tags" to ExtraSpec(ExtraType.STRING_ARRAY),
    "few" to ExtraSpec(ExtraType.STRING_ARRAY, max = 2),
  )

  private fun rejected(raw: Map<String, Any?>, spec: Map<String, ExtraSpec> = this.spec) = (AppLinkGuard.validateExtras(spec, raw) as? ExtrasCheck.Rejected)?.reason
  private fun ok(raw: Map<String, Any?>) = (AppLinkGuard.validateExtras(spec, raw) as ExtrasCheck.Ok).extras

  @Test fun acceptsEveryTypeAndOptionalKeysMayBeAbsent() {
    assertEquals(mapOf<String, Any>("text" to "hi"), ok(mapOf("text" to "hi")))
    assertEquals(
      mapOf<String, Any>("text" to "hi", "id" to 7L, "flag" to true, "tags" to listOf("a", "b")),
      ok(mapOf("text" to "hi", "id" to 7, "flag" to true, "tags" to arrayOf("a", "b"))),
    )
  }

  @Test fun stringLimitsAtTheBoundaryAndOneOver() {
    ok(mapOf("text" to "x".repeat(AppLinkGuard.MAX_STRING_CHARS)))
    assertEquals("text is too long", rejected(mapOf("text" to "x".repeat(AppLinkGuard.MAX_STRING_CHARS + 1))))
    ok(mapOf("text" to "t", "short" to "12345"))
    assertEquals("short is too long", rejected(mapOf("text" to "t", "short" to "123456")))
  }

  @Test fun arrayLimitsAtTheBoundaryAndOneOver() {
    ok(mapOf("text" to "t", "tags" to List(AppLinkGuard.MAX_ARRAY_ITEMS) { "a" }))
    assertEquals("tags has too many items", rejected(mapOf("text" to "t", "tags" to List(AppLinkGuard.MAX_ARRAY_ITEMS + 1) { "a" })))
    ok(mapOf("text" to "t", "few" to listOf("a", "b")))
    assertEquals("few has too many items", rejected(mapOf("text" to "t", "few" to listOf("a", "b", "c"))))
    ok(mapOf("text" to "t", "tags" to listOf("x".repeat(AppLinkGuard.MAX_ARRAY_ITEM_CHARS))))
    assertEquals("tags has an item that is too long", rejected(mapOf("text" to "t", "tags" to listOf("x".repeat(AppLinkGuard.MAX_ARRAY_ITEM_CHARS + 1)))))
  }

  @Test fun unknownKeyMissingRequiredAndWrongTypesAreRefused() {
    assertEquals("unknown extra other", rejected(mapOf("text" to "t", "other" to "x")))
    assertEquals("missing extra text", rejected(emptyMap()))
    assertEquals("text must be text", rejected(mapOf("text" to 5)))
    assertEquals("text must be text", rejected(mapOf("text" to null)))
    assertEquals("id must be a whole number", rejected(mapOf("text" to "t", "id" to "7")))
    assertEquals("id must be a whole number", rejected(mapOf("text" to "t", "id" to 1.5)))
    assertEquals("id must be a whole number", rejected(mapOf("text" to "t", "id" to Long.MAX_VALUE)))
    assertEquals("flag must be true or false", rejected(mapOf("text" to "t", "flag" to "true")))
    assertEquals("tags must be a list of text", rejected(mapOf("text" to "t", "tags" to listOf("a", 1))))
    assertEquals("tags must be a list of text", rejected(mapOf("text" to "t", "tags" to "a")))
  }

  @Test fun aNulCharacterIsRefusedInStringsAndArrayItems() {
    assertEquals("text contains a NUL character", rejected(mapOf("text" to "a\u0000b")))
    assertEquals("tags contains a NUL character", rejected(mapOf("text" to "t", "tags" to listOf("a\u0000"))))
  }

  @Test fun aLongTakesAnIntOrALongWithinTheSafeRange() {
    assertEquals(3L, ok(mapOf("text" to "t", "id" to 3))["id"])
    assertEquals(9007199254740991L, ok(mapOf("text" to "t", "id" to 9007199254740991L))["id"])
    assertEquals("id must be a whole number", rejected(mapOf("text" to "t", "id" to 9007199254740992L)))
  }

  @Test fun tooManyKeysAreRefused() {
    val wide = (1..AppLinkGuard.MAX_EXTRAS + 1).associate { "k$it" to ExtraSpec(ExtraType.BOOLEAN) }
    assertEquals(null, rejected((1..AppLinkGuard.MAX_EXTRAS).associate { "k$it" to true }, wide))
    assertEquals("more than 8 extras", rejected((1..AppLinkGuard.MAX_EXTRAS + 1).associate { "k$it" to true }, wide))
  }

  @Test fun theTotalOfAllTextIsCapped() {
    // Four strings of 2000 chars are exactly MAX_TOTAL_CHARS; one more char is over.
    val five = (1..5).associate { "s$it" to ExtraSpec(ExtraType.STRING) }
    val four = (1..4).associate { "s$it" to "x".repeat(2000) }
    assertEquals(null, rejected(four, five))
    assertEquals("extras hold more than 8000 characters", rejected(four + ("s5" to "x"), five))
  }

  @Test fun neverThrowsOnOddInput() {
    assertFalse(AppLinkGuard.validateExtras(spec, mapOf("text" to Any())) is ExtrasCheck.Ok)
  }

  @Test fun aLongTakesAWholeDoubleAndReturnsALong() {
    assertEquals(5L, ok(mapOf("text" to "t", "id" to 5.0))["id"])
    assertEquals(-5L, ok(mapOf("text" to "t", "id" to -5.0))["id"])
    assertEquals(9007199254740991L, ok(mapOf("text" to "t", "id" to 9007199254740991.0))["id"])
    assertEquals("id must be a whole number", rejected(mapOf("text" to "t", "id" to 9007199254740992.0)))
    assertEquals("id must be a whole number", rejected(mapOf("text" to "t", "id" to 1.5)))
    assertEquals("id must be a whole number", rejected(mapOf("text" to "t", "id" to Double.NaN)))
    assertEquals("id must be a whole number", rejected(mapOf("text" to "t", "id" to Double.POSITIVE_INFINITY)))
  }

  @Test fun aSpecWithAMaxOutOfRangeIsRefusedNotThrown() {
    fun bad(s: ExtraSpec) = rejected(mapOf("k" to "x"), mapOf("k" to s))
    for (s in listOf(
      ExtraSpec(ExtraType.STRING, max = 0), ExtraSpec(ExtraType.STRING, max = -1), ExtraSpec(ExtraType.STRING, max = AppLinkGuard.MAX_STRING_CHARS + 1),
      ExtraSpec(ExtraType.STRING_ARRAY, max = 0), ExtraSpec(ExtraType.STRING_ARRAY, max = AppLinkGuard.MAX_ARRAY_ITEMS + 1),
      ExtraSpec(ExtraType.LONG, max = 5), ExtraSpec(ExtraType.BOOLEAN, max = 5),
    )) assertTrue("$s", bad(s)!!.startsWith("bad spec for k: "))
    // the bad spec is refused even when the caller sends nothing for it
    assertTrue(rejected(emptyMap(), mapOf("k" to ExtraSpec(ExtraType.STRING, max = 0)))!!.startsWith("bad spec"))
    assertEquals(null, rejected(mapOf("k" to "x"), mapOf("k" to ExtraSpec(ExtraType.STRING, max = AppLinkGuard.MAX_STRING_CHARS))))
    assertEquals(null, rejected(mapOf("k" to listOf("x")), mapOf("k" to ExtraSpec(ExtraType.STRING_ARRAY, max = AppLinkGuard.MAX_ARRAY_ITEMS))))
  }

  // The same table the TypeScript validateExtras runs (extras-cases.test.ts); only ok / not ok is compared.
  private fun value(e: JsonElement): Any? = when (e) {
    is JsonNull -> null
    is JsonArray -> e.map { value(it) }
    is JsonObject -> e.getValue("repeat").jsonPrimitive.content.repeat(e.getValue("n").jsonPrimitive.int) // {"repeat":"x","n":2000}
    is JsonPrimitive -> when {
      e.isString -> e.content
      e.content == "true" || e.content == "false" -> e.content.toBoolean()
      e.content.any { it == '.' || it == 'e' || it == 'E' } -> e.content.toDouble()
      else -> e.content.toLong()
    }
  }

  private fun type(s: String) = when (s) {
    "string" -> ExtraType.STRING
    "long" -> ExtraType.LONG
    "boolean" -> ExtraType.BOOLEAN
    "stringArray" -> ExtraType.STRING_ARRAY
    else -> throw AssertionError("unknown type $s")
  }

  @Test fun everyRowOfTheSharedExtrasTableGetsTheSameVerdictAsTypeScript() {
    val cases = Json.parseToJsonElement(fixture("extras-cases.json")).jsonArray
    assertTrue(cases.size >= 30)
    for (c in cases.map { it.jsonObject }) {
      val spec = c.getValue("spec").jsonObject.mapValues { (_, v) ->
        val o = v.jsonObject
        ExtraSpec(type(o.getValue("type").jsonPrimitive.content), o["max"]?.jsonPrimitive?.int, o["required"]?.jsonPrimitive?.boolean ?: false)
      }
      val raw = c.getValue("raw").jsonObject.mapValues { value(it.value) }
      val verdict = AppLinkGuard.validateExtras(spec, raw)
      assertEquals(c.getValue("name").jsonPrimitive.content, c.getValue("ok").jsonPrimitive.boolean, verdict is ExtrasCheck.Ok)
    }
  }
}
