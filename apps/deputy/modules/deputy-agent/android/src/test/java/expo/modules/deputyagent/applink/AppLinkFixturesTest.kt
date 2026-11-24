package expo.modules.deputyagent.applink

import expo.modules.deputyagent.applink.AppLinkGuard.ExtraSpec
import expo.modules.deputyagent.applink.AppLinkGuard.ExtraType
import expo.modules.deputyagent.applink.AppLinkGuard.ExtrasCheck
import expo.modules.deputyagent.core.ProposeTask
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppLinkFixturesTest {
  companion object {
    // Gradle runs module unit tests from the module's android/ folder: five levels up is the repo root.
    fun fixture(name: String): String {
      val f = File("../../../../../packages/app-link-contract/fixtures/$name")
      assertTrue("fixture not found from ${File(".").absoluteFile}", f.isFile)
      return f.readText()
    }

    /** JSON to the values an intent's extras hold; `{ "repeat": "x", "n": 300 }` stands for 300 x. */
    fun value(e: JsonElement): Any? = when (e) {
      is JsonNull -> null
      is JsonArray -> e.map(::value)
      is JsonObject -> e.getValue("repeat").jsonPrimitive.content.repeat(e.getValue("n").jsonPrimitive.int)
      is JsonPrimitive -> when {
        e.isString -> e.content
        e.booleanOrNull != null -> e.boolean
        e.longOrNull != null -> e.longOrNull
        else -> e.content.toDouble()
      }
    }

    fun spec(o: JsonObject): Map<String, ExtraSpec> = o.mapValues { (_, v) ->
      val s = v.jsonObject
      val type = when (s.getValue("type").jsonPrimitive.content) {
        "string" -> ExtraType.STRING
        "long" -> ExtraType.LONG
        "boolean" -> ExtraType.BOOLEAN
        "stringArray" -> ExtraType.STRING_ARRAY
        else -> throw AssertionError("unknown type in $s")
      }
      ExtraSpec(type, s["max"]?.jsonPrimitive?.int, s["required"]?.jsonPrimitive?.boolean ?: false)
    }

    fun proposeCases() = Json.parseToJsonElement(fixture("propose-task-extras.json")).jsonArray.map { it.jsonObject }
    fun raw(case: JsonObject) = case.getValue("raw").jsonObject.mapValues { value(it.value) }
  }

  @Test fun decideEqualsEveryCallerFixtureRow() {
    val rows = Json.parseToJsonElement(fixture("caller-decisions.json")).jsonArray.map { it.jsonObject }
    assertEquals(8, rows.size)
    for (r in rows) {
      val d = AppLinkGuard.decide(r.getValue("isSelf").jsonPrimitive.boolean, r.getValue("holdsPermission").jsonPrimitive.boolean, r.getValue("signatureMatches").jsonPrimitive.boolean)
      assertEquals("$r", r.getValue("allow").jsonPrimitive.boolean, d.allow)
    }
  }

  @Test fun theActivityCallerCheckEqualsEveryFixtureRow() {
    val rows = Json.parseToJsonElement(fixture("activity-caller-decisions.json")).jsonArray.map { it.jsonObject }
    assertTrue(rows.size >= 7)
    for (r in rows) {
      val pkg = (r.getValue("callingPackage") as? JsonPrimitive)?.takeIf { it.isString }?.content
      assertEquals("$r", r.getValue("allow").jsonPrimitive.boolean, AppLinkActivityCaller.allowedActivityCaller(pkg, r.getValue("signaturesMatch").jsonPrimitive.boolean))
    }
  }

  @Test fun theLimitsEqualTheSharedFixture() {
    val l = Json.parseToJsonElement(fixture("limits.json")).jsonObject.mapValues { it.value.jsonPrimitive.int }
    assertEquals(
      mapOf(
        "MAX_EXTRAS" to AppLinkGuard.MAX_EXTRAS, "MAX_STRING_CHARS" to AppLinkGuard.MAX_STRING_CHARS, "MAX_ARRAY_ITEMS" to AppLinkGuard.MAX_ARRAY_ITEMS,
        "MAX_ARRAY_ITEM_CHARS" to AppLinkGuard.MAX_ARRAY_ITEM_CHARS, "MAX_TOTAL_CHARS" to AppLinkGuard.MAX_TOTAL_CHARS,
        "MAX_RESULT_MESSAGE_CHARS" to AppLinkGuard.MAX_RESULT_MESSAGE_CHARS,
      ),
      l,
    )
  }

  @Test fun deputysProposeTaskSpecIsTheFixtureSpec() {
    val cases = proposeCases()
    assertTrue(cases.size >= 10)
    for (c in cases) assertEquals(c.getValue("name").jsonPrimitive.content, spec(c.getValue("spec").jsonObject), ProposeTask.SPEC)
  }

  @Test fun everyProposeTaskCaseIsAcceptedOrRefusedAsTheFixtureSays() {
    for (c in proposeCases()) {
      val name = c.getValue("name").jsonPrimitive.content
      val ok = c.getValue("ok").jsonPrimitive.boolean
      val check = AppLinkGuard.validateExtras(ProposeTask.SPEC, raw(c))
      assertEquals(name, ok, check is ExtrasCheck.Ok)
      val proposal = ProposeTask.from("p1", raw(c), "Inflow", emptyMap())
      if (ok) assertNotNull(name, proposal) else assertNull(name, proposal)
    }
  }
}
