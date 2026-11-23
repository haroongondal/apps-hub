package expo.modules.netlenscore

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

/** Binds the provider's columns, authority, paths and row caps to the shares packages/core declares (E1 README step 6). */
class HomeLinkProviderShareTest {
  private fun share(name: String): JsonObject {
    val f = File("../../../../../packages/core/fixtures/$name")
    assertTrue("fixture not found from ${File(".").absoluteFile}", f.isFile)
    return Json.parseToJsonElement(f.readText()).jsonObject
  }

  private fun check(fixture: String, path: String, columns: Array<String>, limit: Int) {
    val s = share(fixture)
    assertEquals(s.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, columns.toList())
    assertEquals(s.getValue("authority").jsonPrimitive.content, HomeShareRows.AUTHORITY)
    assertEquals(s.getValue("path").jsonPrimitive.content, path)
    assertTrue(limit <= s.getValue("maxRows").jsonPrimitive.int)
  }

  @Test fun whoIsHomeEqualsItsShare() =
    check("who-is-home.share.json", HomeShareRows.WHO_IS_HOME_PATH, HomeShareRows.WHO_IS_HOME_COLUMNS, HomeShareRows.WHO_IS_HOME_LIMIT)

  @Test fun newDevicesEqualsItsShare() =
    check("new-devices.share.json", HomeShareRows.NEW_DEVICES_PATH, HomeShareRows.NEW_DEVICES_COLUMNS, HomeShareRows.NEW_DEVICES_LIMIT)

  @Test fun healthEqualsTheContractHealthShare() {
    val f = File("../../../../../packages/app-link-contract/fixtures/app-health.share.json")
    assertTrue("fixture not found from ${File(".").absoluteFile}", f.isFile)
    val s = Json.parseToJsonElement(f.readText()).jsonObject
    assertEquals(s.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, HomeShareRows.HEALTH_COLUMNS.toList())
    assertEquals(s.getValue("path").jsonPrimitive.content, HomeShareRows.HEALTH_PATH)
    assertTrue(HomeShareRows.HEALTH_LIMIT <= s.getValue("maxRows").jsonPrimitive.int)
  }

  @Test fun healthIsOneNonPersonalRowServedEvenWithSharingOff() {
    val rows = HomeShareRows.health(1_764_000_000_000L)
    assertEquals(1, rows.size)
    assertEquals(listOf("netlens", null, null, "none", 1_764_000_000_000L), rows[0].toList())
    assertEquals(null, HomeShareRows.health(null)[0][4])
    val off = HomeWatchState(settings = HomeSettings(share = false))
    assertTrue(HomeShareRows.whoIsHome(off).isEmpty() && HomeShareRows.newDevices(off).isEmpty())
  }

  @Test fun everyRowHasExactlyTheShareColumns() {
    val state = HomeWatchState(
      settings = HomeSettings(whoIsHome = true, newDevices = true, share = true),
      people = listOf(PersonWatch("Sara", listOf("192.168.1.20"), Presence.UNKNOWN)),
      alerts = listOf(NewDevices.Alert("192.168.1.50", 1, "Computer", false)),
    )
    assertTrue(HomeShareRows.whoIsHome(state).all { it.size == HomeShareRows.WHO_IS_HOME_COLUMNS.size })
    assertTrue(HomeShareRows.newDevices(state).all { it.size == HomeShareRows.NEW_DEVICES_COLUMNS.size })
    assertTrue(HomeShareRows.health(null).all { it.size == HomeShareRows.HEALTH_COLUMNS.size })
  }
}
