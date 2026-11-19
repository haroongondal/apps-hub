package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PowerStateTest {
  @Test
  fun chargingFromStatusOrPlug() {
    assertTrue(PowerState.charging(status = 3, plugged = 1)) // discharging status but plugged (paused charging)
    assertTrue(PowerState.charging(status = 2, plugged = 0))
    assertTrue(PowerState.charging(status = 5, plugged = 0))
    assertFalse(PowerState.charging(status = 3, plugged = 0))
    assertFalse(PowerState.charging(status = 4, plugged = 0))
  }

  @Test
  fun percentScalesAndRejectsMissing() {
    assertEquals(15, PowerState.percent(15, 100))
    assertEquals(50, PowerState.percent(100, 200))
    assertNull(PowerState.percent(-1, 100))
    assertNull(PowerState.percent(10, 0))
  }

  @Test
  fun lowBatteryAtFifteenAndNotCharging() {
    assertTrue(PowerState.lowBattery(15, charging = false))
    assertTrue(PowerState.lowBattery(3, charging = false))
    assertFalse(PowerState.lowBattery(16, charging = false))
    assertFalse(PowerState.lowBattery(5, charging = true))
    assertFalse(PowerState.lowBattery(null, charging = false))
  }

  @Test
  fun alarmSoonWithinAnHour() {
    val now = 1_795_000_000_000L
    assertTrue(PowerState.alarmSoon(now + 60 * 60_000L, now))
    assertTrue(PowerState.alarmSoon(now, now))
    assertFalse(PowerState.alarmSoon(now + 60 * 60_000L + 1, now))
    assertFalse(PowerState.alarmSoon(now - 1, now))
    assertFalse(PowerState.alarmSoon(null, now))
  }
}
