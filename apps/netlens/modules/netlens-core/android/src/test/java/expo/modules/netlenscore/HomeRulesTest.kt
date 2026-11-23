package expo.modules.netlenscore

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeRulesTest {
  // Gradle runs module unit tests from the module's android/ folder: five levels up is the repo root.
  private fun fixture(name: String): JsonElement {
    val f = File("../../../../../packages/core/fixtures/$name")
    assertTrue("fixture not found from ${File(".").absoluteFile}", f.isFile)
    return Json.parseToJsonElement(f.readText())
  }

  private fun state(o: JsonObject) = Presence.State(
    o.getValue("present").jsonPrimitive.boolean,
    o.getValue("misses").jsonPrimitive.int,
    o.getValue("lastSeenAt").jsonPrimitive.long,
  )

  @Test fun presenceEqualsEveryFixtureCase() {
    val cases = fixture("presence-cases.json").jsonArray.map { it.jsonObject }
    assertEquals(7, cases.size)
    for (c in cases) {
      var s = state(c.getValue("start").jsonObject)
      val expect = c.getValue("expect").jsonArray
      c.getValue("steps").jsonArray.forEachIndexed { i, step ->
        val st = step.jsonObject
        s = Presence.next(s, st.getValue("answered").jsonPrimitive.boolean, st.getValue("now").jsonPrimitive.long, c.getValue("awayAfter").jsonPrimitive.int)
        assertEquals("${c["name"]} step $i", state(expect[i].jsonObject), s)
      }
    }
  }

  @Test fun newDevicesEqualEveryFixtureCase() {
    val cases = fixture("new-device-cases.json").jsonArray.map { it.jsonObject }
    assertEquals(11, cases.size)
    for (c in cases) {
      val ctx = c.getValue("ctx").jsonObject
      val gateway = ctx.getValue("gatewayIp").let { if (it is JsonNull) null else it.jsonPrimitive.content }
      val found = NewDevices.find(
        alive = c.getValue("alive").jsonArray.map { a ->
          val o = a.jsonObject
          NewDevices.Alive(o.getValue("ip").jsonPrimitive.content, o.getValue("port").let { if (it is JsonNull) null else it.jsonPrimitive.int })
        },
        known = c.getValue("known").jsonArray.map { k ->
          val o = k.jsonObject
          NewDevices.Known(o.getValue("ip").jsonPrimitive.content, o.getValue("lastSeenAt").jsonPrimitive.long, o.getValue("tagged").jsonPrimitive.boolean)
        },
        alerts = c.getValue("alerts").jsonArray.map { a ->
          val o = a.jsonObject
          NewDevices.Alert(o.getValue("ip").jsonPrimitive.content, o.getValue("firstSeenAt").jsonPrimitive.long, o.getValue("label").jsonPrimitive.content, o.getValue("acknowledged").jsonPrimitive.boolean)
        },
        selfIp = ctx.getValue("selfIp").jsonPrimitive.content,
        gatewayIp = gateway,
        now = ctx.getValue("now").jsonPrimitive.long,
        windowDays = ctx.getValue("windowDays").jsonPrimitive.int,
      )
      assertEquals("${c["name"]}", c.getValue("expect").jsonArray.map { it.jsonPrimitive.content }, found.map { it.ip })
    }
  }

  @Test fun theGuessMatchesTheTypeScriptOne() {
    assertEquals("iPhone or iPad", NewDevices.guess(62078))
    assertEquals("Computer", NewDevices.guess(445))
    assertEquals("Unknown device", NewDevices.guess(80))
    assertEquals("Unknown device", NewDevices.guess(null))
  }

  @Test fun aSnapshotSightingOnlyMovesPresenceForward() {
    val prev = Presence.State(present = false, misses = 5, lastSeenAt = 100)
    assertEquals(Presence.State(true, 0, 200), Presence.merge(prev, seenNow = true, lastSeenAt = 200))
    assertEquals(prev, Presence.merge(prev, seenNow = true, lastSeenAt = 100))
    assertEquals(prev, Presence.merge(prev, seenNow = false, lastSeenAt = 300))
    assertEquals(Presence.State(false, Presence.AWAY_AFTER_MISSES, 50), Presence.merge(null, seenNow = false, lastSeenAt = 50))
    assertEquals(Presence.State(true, 0, 50), Presence.merge(null, seenNow = true, lastSeenAt = 50))
  }

  @Test fun recordKeepsMineAndRecentDropsExpiredAndCaps() {
    val day = 86_400_000L
    val now = 100 * day
    val old = NewDevices.Alert("192.168.1.5", now - 40 * day, "Computer", acknowledged = false)
    val mine = NewDevices.Alert("192.168.1.6", now - 400 * day, "Computer", acknowledged = true)
    val recent = NewDevices.Alert("192.168.1.7", now - day, "Unknown device", acknowledged = false)
    val fresh = NewDevices.Alert("192.168.1.5", now, "iPhone or iPad", acknowledged = false)
    assertEquals(listOf(fresh, recent, mine), NewDevices.record(listOf(old, mine, recent), listOf(fresh), now))
    val many = (1..250).map { NewDevices.Alert("10.0.0.$it", now - it, "Unknown device", false) }
    assertEquals(NewDevices.MAX_ALERTS, NewDevices.record(many, emptyList(), now).size)
    assertTrue(NewDevices.acknowledge(listOf(recent), "192.168.1.7").single().acknowledged)
    assertEquals(now, NewDevices.refreshKnown(listOf(NewDevices.Known("192.168.1.9", 1, false)), setOf("192.168.1.9"), now).single().lastSeenAt)
  }

  @Test fun theSweepIsTheSlash24AroundThisPhoneAndNeverMore() {
    val hosts = HomeSubnet.sweepHosts("192.168.7.42")
    assertEquals(254, hosts.size)
    assertEquals("192.168.7.1", hosts.first())
    assertEquals("192.168.7.254", hosts.last())
    assertTrue(hosts.all { it.startsWith("192.168.7.") })
    assertEquals(emptyList<String>(), HomeSubnet.sweepHosts("not an ip"))
    assertTrue(HomeSubnet.sameSlash24("192.168.7.9", "192.168.7.200"))
    assertFalse(HomeSubnet.sameSlash24("192.168.8.9", "192.168.7.200"))
    assertFalse(HomeSubnet.sameSlash24("8.8.8.8", "bad"))
  }

  @Test fun shareRowsCarryOnlyTheDeclaredValuesAndOnlyWhenSharingIsOn() {
    val state = HomeWatchState(
      settings = HomeSettings(whoIsHome = true, newDevices = true, share = true, home = HomeNetwork("net_1", "192.168.1.1", "Home")),
      people = listOf(PersonWatch("Sara", listOf("192.168.1.20"), Presence.State(true, 0, 1234))),
      alerts = listOf(NewDevices.Alert("192.168.1.50", 99, "Computer", acknowledged = true)),
    )
    assertEquals(listOf(listOf<Any>("Sara", 1, 1234L)), HomeShareRows.whoIsHome(state).map { it.toList() })
    assertEquals(listOf(listOf<Any>(99L, "Computer", 1)), HomeShareRows.newDevices(state).map { it.toList() })
    val values = (HomeShareRows.whoIsHome(state) + HomeShareRows.newDevices(state)).flatMap { it.toList() }.map(Any::toString)
    assertFalse("no address may cross a share", values.any { it.contains("192.168.") })
    val off = state.copy(settings = state.settings.copy(share = false))
    assertTrue(HomeShareRows.whoIsHome(off).isEmpty() && HomeShareRows.newDevices(off).isEmpty())
    val featureOff = state.copy(settings = state.settings.copy(whoIsHome = false, newDevices = false))
    assertTrue(HomeShareRows.whoIsHome(featureOff).isEmpty() && HomeShareRows.newDevices(featureOff).isEmpty())
  }

  @Test fun everyBackgroundSettingIsOffByDefault() {
    assertEquals(HomeSettings(false, false, 6, false, null), HomeSettings())
  }
}
