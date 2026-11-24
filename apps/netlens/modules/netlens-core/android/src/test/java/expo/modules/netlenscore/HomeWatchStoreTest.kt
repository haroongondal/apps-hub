package expo.modules.netlenscore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeWatchStoreTest {
  private val home = mapOf(
    "networkId" to "net_1", "gatewayIp" to "192.168.1.1", "label" to "Home",
    "routerId" to "uuid:home-router-1", "routerUrl" to "http://192.168.1.1:5000/rootDesc.xml",
  )
  private val on = mapOf<String, Any?>("whoIsHome" to true, "newDevices" to true, "newDeviceHours" to 12.0, "share" to false, "home" to home)

  @Test fun onlyPrivateAddressesFromTheAppAreKept() {
    val snapshot = mapOf<String, Any?>(
      "people" to listOf(mapOf("label" to "Sara", "ips" to listOf("192.168.1.20", "8.8.8.8", "192.168.1.20; rm", "example.com"), "seenNow" to true, "lastSeenAt" to 5.0)),
      "known" to listOf(mapOf("ip" to "1.1.1.1", "lastSeenAt" to 1.0, "tagged" to false), mapOf("ip" to "10.0.0.4", "lastSeenAt" to 2.0, "tagged" to true)),
    )
    val s = HomeWatchStore.applyFromApp(HomeWatchState(), on, snapshot)
    assertEquals(listOf("192.168.1.20"), s.people.single().ips)
    assertEquals(Presence.State(true, 0, 5), s.people.single().state)
    assertEquals(listOf(NewDevices.Known("10.0.0.4", 2, true)), s.known)
    assertEquals(12, s.settings.newDeviceHours)
  }

  @Test fun badSettingsFallBackToOffAndSixHours() {
    val s = HomeWatchStore.applyFromApp(
      HomeWatchState(),
      mapOf("whoIsHome" to "true", "newDevices" to 1, "newDeviceHours" to 5, "share" to null, "home" to mapOf("networkId" to "n", "gatewayIp" to "8.8.8.8")),
      null,
    )
    assertEquals(HomeSettings(), s.settings)
    assertNull(s.settings.home)
  }

  @Test fun aNewHomeNetworkStartsClean() {
    val prev = HomeWatchStore.applyFromApp(HomeWatchState(), on, null)
      .copy(alerts = listOf(NewDevices.Alert("192.168.1.50", 1, "Computer", false)))
    val same = HomeWatchStore.applyFromApp(prev, on, null)
    assertEquals(1, same.alerts.size)
    val moved = HomeWatchStore.applyFromApp(prev, on + ("home" to home + ("networkId" to "net_2")), null)
    assertTrue(moved.alerts.isEmpty())
    val cleared = HomeWatchStore.applyFromApp(prev, on + ("home" to null), mapOf("people" to listOf(mapOf("label" to "Sara"))))
    assertTrue(cleared.alerts.isEmpty() && cleared.people.isEmpty())
  }

  @Test fun theBackgroundPresenceSurvivesASnapshotFromAnOlderScan() {
    val prev = HomeWatchState(
      settings = HomeSettings(whoIsHome = true, home = HomeNetwork("net_1", "192.168.1.1", "Home")),
      people = listOf(PersonWatch("Sara", listOf("192.168.1.20"), Presence.State(false, 4, 900))),
    )
    val snapshot = mapOf<String, Any?>("people" to listOf(mapOf("label" to "sara", "ips" to listOf("192.168.1.20"), "seenNow" to true, "lastSeenAt" to 800.0)))
    val s = HomeWatchStore.applyFromApp(prev, on, snapshot)
    assertFalse(s.people.single().state.present)
  }

  @Test fun aHomeWithoutTheRouterIdOrWithItsDescriptionOffTheGatewayIsNotSaved() {
    val saved = HomeWatchStore.applyFromApp(HomeWatchState(), on, null).settings.home
    assertEquals(HomeNetwork("net_1", "192.168.1.1", "Home", "uuid:home-router-1", "http://192.168.1.1:5000/rootDesc.xml"), saved)
    for (bad in listOf(
      home - "routerId",
      home + ("routerId" to ""),
      home + ("routerId" to "not-a-uuid"),
      home - "routerUrl",
      home + ("routerUrl" to "http://192.168.1.7:5000/rootDesc.xml"),
    )) {
      assertNull(bad.toString(), HomeWatchStore.applyFromApp(HomeWatchState(), on + ("home" to bad), null).settings.home)
    }
    @Suppress("UNCHECKED_CAST")
    val status = (HomeWatchStore.status(HomeWatchStore.applyFromApp(HomeWatchState(), on, null))["settings"] as Map<String, Any?>)["home"] as Map<String, Any?>
    assertEquals("uuid:home-router-1", status["routerId"])
    assertEquals("http://192.168.1.1:5000/rootDesc.xml", status["routerUrl"])
  }

  @Test fun privateCheck() {
    assertTrue(HomeWatchStore.isPrivateIpv4("172.16.0.1"))
    assertTrue(HomeWatchStore.isPrivateIpv4("169.254.3.4"))
    assertFalse(HomeWatchStore.isPrivateIpv4("172.32.0.1"))
    assertFalse(HomeWatchStore.isPrivateIpv4("localhost"))
    assertFalse(HomeWatchStore.isPrivateIpv4("fe80::1"))
  }

  private val stored = HomeWatchStore.applyFromApp(HomeWatchState(), on + ("share" to true), null)
  private val synced = home + ("label" to "Flat 4") + ("routerUrl" to "http://192.168.1.1:5000/new.xml")
  private val snapshot = mapOf<String, Any?>("people" to listOf(mapOf("label" to "Sara", "ips" to listOf("192.168.1.20"), "seenNow" to true, "lastSeenAt" to 5.0)))

  @Test fun theHomeSyncRefreshesTheHomeAndSnapshotButNeverTheSwitches() {
    val s = HomeWatchStore.applyHomeSync(stored, synced, snapshot)
    assertEquals("Flat 4", s.settings.home?.label)
    assertEquals("http://192.168.1.1:5000/new.xml", s.settings.home?.routerUrl)
    assertEquals("Sara", s.people.single().label)
    assertEquals(stored.settings.copy(home = s.settings.home), s.settings)
    assertTrue(s.settings.share && s.settings.whoIsHome && s.settings.newDevices)
  }

  @Test fun theHomeSyncChangesNothingForAnotherHomeNoHomeOrBothChecksOff() {
    assertEquals(stored, HomeWatchStore.applyHomeSync(stored, synced + ("networkId" to "net_2"), snapshot))
    assertEquals(stored, HomeWatchStore.applyHomeSync(stored, synced + ("routerId" to "uuid:other-router"), snapshot))
    val none = HomeWatchState()
    assertEquals(none, HomeWatchStore.applyHomeSync(none, synced, snapshot))
    val off = stored.copy(settings = stored.settings.copy(whoIsHome = false, newDevices = false))
    assertEquals(off, HomeWatchStore.applyHomeSync(off, synced, snapshot))
  }
}
