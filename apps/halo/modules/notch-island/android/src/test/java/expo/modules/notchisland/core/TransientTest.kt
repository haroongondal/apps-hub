package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TransientTest {
  private val plug = Transient.Charging(true, 82, false, null)
  private val unplug = Transient.Charging(false, 82, false, null)
  private val silent = Transient.Ringer(RingerMode.SILENT)

  @Test fun anEventShowsOnAFoldedPill() {
    assertEquals(plug, Transients.decide(null, plug, callActive = false, cardOpen = false))
  }

  @Test fun aCallDropsEveryEvent() {
    assertNull(Transients.decide(null, plug, callActive = true, cardOpen = false))
    assertNull(Transients.decide(silent, plug, callActive = true, cardOpen = false))
  }

  @Test fun aCardTheUserOpenedIsNeverReplaced() {
    assertNull(Transients.decide(null, silent, callActive = false, cardOpen = true))
  }

  @Test fun aNewerEventOfTheSameKindReplacesTheOlder() {
    assertEquals(unplug, Transients.decide(plug, unplug, callActive = false, cardOpen = false))
  }

  @Test fun aNewerEventOfAnotherKindAlsoWins() {
    assertEquals(silent, Transients.decide(plug, silent, callActive = false, cardOpen = false))
  }

  @Test fun anExactRepeatIsDropped() {
    assertNull(Transients.decide(silent, Transient.Ringer(RingerMode.SILENT), callActive = false, cardOpen = false))
  }

  @Test fun switchesGateEachKind() {
    val off = EventSwitches(charging = false, ringer = true, dnd = false)
    assertFalse(Transients.allowed(plug, off))
    assertFalse(Transients.allowed(Transient.LowBattery(20), off))
    assertTrue(Transients.allowed(silent, off))
    assertFalse(Transients.allowed(Transient.Dnd(true), off))
  }

  @Test fun lowBatteryFiresOnceWhenCrossingTwentyAndTen() {
    assertEquals(20, Transients.lowBatteryCrossing(21, 20, plugged = false))
    assertNull(Transients.lowBatteryCrossing(20, 19, plugged = false))
    assertEquals(10, Transients.lowBatteryCrossing(11, 10, plugged = false))
    assertNull(Transients.lowBatteryCrossing(10, 9, plugged = false))
    assertEquals(10, Transients.lowBatteryCrossing(25, 8, plugged = false))
  }

  @Test fun lowBatteryIsQuietWhilePluggedRisingOrOnTheFirstReading() {
    assertNull(Transients.lowBatteryCrossing(21, 20, plugged = true))
    assertNull(Transients.lowBatteryCrossing(19, 21, plugged = false))
    assertNull(Transients.lowBatteryCrossing(null, 15, plugged = false))
  }

  private fun lowEvents(levels: List<Int>, plugged: List<Boolean> = levels.map { false }): List<Int> {
    var fired: Int? = null
    var prev: Int? = null
    val out = mutableListOf<Int>()
    levels.forEachIndexed { i, now ->
      val step = Transients.lowBatteryStep(prev, now, plugged[i], fired)
      fired = step.fired
      step.event?.let { out += it }
      prev = now
    }
    return out
  }

  @Test fun lowBatteryDoesNotRefireWhenTheLevelBouncesAtTheThreshold() {
    assertEquals(listOf(20), lowEvents(listOf(21, 20, 21, 20)))
    assertEquals(listOf(20, 10), lowEvents(listOf(21, 20, 21, 20, 11, 10, 11, 10)))
  }

  @Test fun lowBatteryRearmsThreePointsAboveOrOnPlugIn() {
    assertEquals(listOf(20, 20), lowEvents(listOf(21, 20, 23, 20)))
    // Plugging in re-arms even though the level never reached 23 before unplugging.
    assertEquals(listOf(20, 20), lowEvents(listOf(21, 20, 20, 21, 20), listOf(false, false, true, false, false)))
    assertEquals(listOf(20, 10), lowEvents(listOf(21, 20, 11, 10)))
  }

  @Test fun ringerAndDndMapThePlatformValues() {
    assertEquals(RingerMode.SILENT, Transients.ringerMode(0))
    assertEquals(RingerMode.VIBRATE, Transients.ringerMode(1))
    assertEquals(RingerMode.RING, Transients.ringerMode(2))
    assertNull(Transients.ringerMode(7))
    assertFalse(Transients.dndOn(0))
    assertFalse(Transients.dndOn(1))
    assertTrue(Transients.dndOn(2))
    assertTrue(Transients.dndOn(3))
    assertTrue(Transients.dndOn(4))
  }

  @Test fun chargingText() {
    assertEquals(TransientText("bolt", "Charging", "82%"), Transients.text(plug))
    assertEquals(TransientText("bolt", "Not charging", "82%"), Transients.text(unplug))
    assertEquals(
      TransientText("bolt", "Charging wirelessly", "40%  ·  Full in 1 h 5 min"),
      Transients.text(Transient.Charging(true, 40, true, 65)),
    )
    assertEquals(TransientText("bolt", "Charging", null), Transients.text(Transient.Charging(true, null, false, null)))
  }

  @Test fun otherTexts() {
    assertEquals(TransientText("battery_low", "Low battery", "10% left"), Transients.text(Transient.LowBattery(10)))
    assertEquals(TransientText("bell", "Ring", null), Transients.text(Transient.Ringer(RingerMode.RING)))
    assertEquals(TransientText("bell_off", "Vibrate", null), Transients.text(Transient.Ringer(RingerMode.VIBRATE)))
    assertEquals(TransientText("bell_off", "Silent", null), Transients.text(silent))
    assertEquals(TransientText("moon", "Do not disturb on", null), Transients.text(Transient.Dnd(true)))
    assertEquals(TransientText("moon", "Do not disturb off", null), Transients.text(Transient.Dnd(false)))
  }

  @Test fun fullInReadsInPlainWords() {
    assertEquals("Full in 1 min", Transients.fullIn(0))
    assertEquals("Full in 45 min", Transients.fullIn(45))
    assertEquals("Full in 2 h", Transients.fullIn(120))
    assertEquals("Full in 1 h 5 min", Transients.fullIn(65))
  }

  @Test fun holdIsTwoAndAHalfSeconds() {
    assertEquals(2500L, Transients.HOLD_MS)
  }

  @Test fun headsetKeysGroupOneDevicesPortsAndSkipOtherOutputs() {
    assertEquals("bt:AA:BB", Transients.headsetKey(8, "AA:BB"))
    assertEquals("bt:AA:BB", Transients.headsetKey(7, "AA:BB"))
    assertEquals("bt:AA:BB", Transients.headsetKey(26, "AA:BB"))
    assertEquals(Transients.WIRED_KEY, Transients.headsetKey(3, ""))
    assertEquals(Transients.WIRED_KEY, Transients.headsetKey(4, ""))
    assertEquals(Transients.WIRED_KEY, Transients.headsetKey(22, ""))
    assertNull(Transients.headsetKey(2, ""))
    assertNull(Transients.headsetKey(1, ""))
  }

  @Test fun headsetChangesReportConnectsAndDisconnectsOnly() {
    val pods = mapOf("bt:AA" to "AirPods Pro")
    assertEquals(listOf(Transient.Headset(true, "AirPods Pro")), Transients.headsetChanges(emptyMap(), pods))
    assertEquals(listOf(Transient.Headset(false, "AirPods Pro")), Transients.headsetChanges(pods, emptyMap()))
    assertEquals(emptyList<Transient.Headset>(), Transients.headsetChanges(pods, pods))
    // Switching from wired to Bluetooth shows the connect last, so it wins.
    assertEquals(
      listOf(Transient.Headset(false, null), Transient.Headset(true, "AirPods Pro")),
      Transients.headsetChanges(mapOf(Transients.WIRED_KEY to null), pods),
    )
  }

  @Test fun headsetTextUsesTheNameWhenKnown() {
    assertEquals(TransientText("headphones", "AirPods Pro", "Connected"), Transients.text(Transient.Headset(true, "AirPods Pro")))
    assertEquals(TransientText("headphones", "AirPods Pro", "Disconnected"), Transients.text(Transient.Headset(false, "AirPods Pro")))
    assertEquals(TransientText("headphones", "Headphones connected", null), Transients.text(Transient.Headset(true, null)))
    assertEquals(TransientText("headphones", "Headphones disconnected", null), Transients.text(Transient.Headset(false, "  ")))
  }

  @Test fun theBluetoothSwitchGatesHeadsetEvents() {
    assertFalse(Transients.allowed(Transient.Headset(true, null), EventSwitches(bluetooth = false)))
    assertTrue(Transients.allowed(Transient.Headset(true, null), EventSwitches()))
    assertTrue(Transients.allowed(plug, EventSwitches(bluetooth = false)))
  }
}
