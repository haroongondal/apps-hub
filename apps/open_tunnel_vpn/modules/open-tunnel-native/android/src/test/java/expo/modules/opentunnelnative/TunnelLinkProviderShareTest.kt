package expo.modules.opentunnelnative

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Binds the provider's columns, authority, paths and row caps to the shares open-tunnel-core declares (app-link README step 6). */
class TunnelLinkProviderShareTest {
  private fun share(name: String): JsonObject {
    val f = File("../../../../../packages/open-tunnel-core/fixtures/$name")
    assertTrue("fixture not found from ${File(".").absoluteFile}", f.isFile)
    return Json.parseToJsonElement(f.readText()).jsonObject
  }

  private fun check(fixture: String, path: String, columns: Array<String>, limit: Int) {
    val s = share(fixture)
    assertEquals(s.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, columns.toList())
    assertEquals(s.getValue("authority").jsonPrimitive.content, ShieldLink.AUTHORITY)
    assertEquals(s.getValue("path").jsonPrimitive.content, path)
    assertTrue(limit <= s.getValue("maxRows").jsonPrimitive.int)
  }

  @Test fun shieldEqualsItsShare() =
    check("shield.share.json", ShieldLink.SHIELD_PATH, ShieldLink.SHIELD_COLUMNS, ShieldLink.SHIELD_LIMIT)

  @Test fun healthEqualsItsShare() =
    check("tunnel-health.share.json", ShieldLink.HEALTH_PATH, ShieldLink.HEALTH_COLUMNS, ShieldLink.HEALTH_LIMIT)

  @Test fun healthAlsoEqualsTheContractHealthFixture() {
    val f = File("../../../../../packages/app-link-contract/fixtures/app-health.share.json")
    val s = Json.parseToJsonElement(f.readText()).jsonObject
    assertEquals(s.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, ShieldLink.HEALTH_COLUMNS.toList())
    assertEquals(s.getValue("path").jsonPrimitive.content, ShieldLink.HEALTH_PATH)
  }

  @Test fun everyRowHasExactlyTheShareColumnsAndAtMostTheCap() {
    val shield = ShieldLink.shieldRows(ShieldState(on = true, untrusted = true, sinceMs = 5L), networkWatched = true)
    assertEquals(ShieldLink.SHIELD_LIMIT, shield.size)
    assertTrue(shield.all { it.size == ShieldLink.SHIELD_COLUMNS.size })
    val health = ShieldLink.healthRows(7L)
    assertEquals(ShieldLink.HEALTH_LIMIT, health.size)
    assertTrue(health.all { it.size == ShieldLink.HEALTH_COLUMNS.size })
  }
}
