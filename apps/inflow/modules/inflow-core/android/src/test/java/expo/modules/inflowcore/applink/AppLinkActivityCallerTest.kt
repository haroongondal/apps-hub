package expo.modules.inflowcore.applink

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppLinkActivityCallerTest {
  // Gradle runs module unit tests from the module's android/ folder: five levels up is the repo root.
  private val rows = File("../../../../../packages/app-link-contract/fixtures/activity-caller-decisions.json").also {
    assertTrue("fixture not found from ${File(".").absoluteFile}", it.isFile)
  }.let { Json.parseToJsonElement(it.readText()).jsonArray.map { r -> r.jsonObject } }

  @Test fun everyFixtureRowGetsTheSameVerdictAsTypeScript() {
    assertEquals(7, rows.size)
    for (r in rows) {
      val pkg = r.getValue("callingPackage").jsonPrimitive.contentOrNull
      val matches = r.getValue("signaturesMatch").jsonPrimitive.boolean
      assertEquals("$r", r.getValue("allow").jsonPrimitive.boolean, AppLinkActivityCaller.allowedActivityCaller(pkg, matches))
    }
  }
}
