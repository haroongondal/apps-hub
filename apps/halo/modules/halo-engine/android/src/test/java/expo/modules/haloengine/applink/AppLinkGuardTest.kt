package expo.modules.haloengine.applink

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class AppLinkGuardTest {
  private fun fixture(name: String) = File("../../../../../packages/app-link-contract/fixtures/$name").readText()

  @Test fun decideEqualsEveryCallerFixtureRow() {
    val rows = Json.parseToJsonElement(fixture("caller-decisions.json")).jsonArray.map { it.jsonObject }
    assertEquals(8, rows.size)
    for (r in rows) {
      val d = AppLinkGuard.decide(r.getValue("isSelf").jsonPrimitive.boolean, r.getValue("holdsPermission").jsonPrimitive.boolean, r.getValue("signatureMatches").jsonPrimitive.boolean)
      assertEquals("$r", r.getValue("allow").jsonPrimitive.boolean, d.allow)
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
}
