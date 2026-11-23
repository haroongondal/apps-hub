package expo.modules.netlenscore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeWatchStoreTest {
  private val home = mapOf("networkId" to "net_1", "gatewayIp" to "192.168.1.1", "label" to "Home")
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

  @Test fun privateCheck() {
    assertTrue(HomeWatchStore.isPrivateIpv4("172.16.0.1"))
    assertTrue(HomeWatchStore.isPrivateIpv4("169.254.3.4"))
    assertFalse(HomeWatchStore.isPrivateIpv4("172.32.0.1"))
    assertFalse(HomeWatchStore.isPrivateIpv4("localhost"))
    assertFalse(HomeWatchStore.isPrivateIpv4("fe80::1"))
  }
}
