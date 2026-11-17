package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AodPolicyTest {
  private val on = SettingsAod(enabled = true)
  private val locked = AodState(keyguardLocked = true, charging = false, musicPlaying = false, minuteOfDay = 12 * 60)

  @Test
  fun neverWhenUnlocked() {
    val p = AodPolicy()
    assertFalse(p.onScreenOff(on, locked.copy(keyguardLocked = false)))
    assertFalse(p.onNotificationWake(on, locked.copy(keyguardLocked = false), true))
    assertTrue(p.onScreenOff(on, locked))
  }

  @Test
  fun disabledNeverLaunches() {
    assertFalse(AodPolicy().onScreenOff(on.copy(enabled = false), locked))
  }

  // Design 10.2: pressing the power button again shows it again, unless it timed out by itself since the unlock.
  @Test
  fun relaunchRule() {
    val p = AodPolicy()
    repeat(3) { assertTrue(p.onScreenOff(on, locked)) }
  }

  @Test
  fun timedOutStaysOffUntilUnlock() {
    val p = AodPolicy()
    assertTrue(p.onScreenOff(on, locked))
    p.onTimedOut()
    assertFalse(p.onScreenOff(on, locked))
    assertFalse(p.onScreenOff(on, locked))
    p.onUnlocked()
    assertTrue(p.onScreenOff(on, locked))
  }

  @Test
  fun neverStopAlwaysReturns() {
    val never = on.copy(timeoutSec = null)
    val p = AodPolicy()
    assertNull(p.timeoutMs(never))
    // A never-stop screen is not timed out by itself; a screen-off after the user closed it shows again.
    repeat(3) { assertTrue(p.onScreenOff(never, locked)) }
    assertEquals(30_000L, p.timeoutMs(on))
    assertEquals(1_800_000L, p.timeoutMs(on.copy(timeoutSec = 1800)))
    assertEquals(10_000L, p.timeoutMs(on.copy(timeoutSec = 10)))
  }

  @Test
  fun triggerCharging() {
    val s = on.copy(trigger = AodTrigger.CHARGING)
    val p = AodPolicy()
    assertFalse(p.onScreenOff(s, locked))
    assertTrue(p.onScreenOff(s, locked.copy(charging = true)))
  }

  @Test
  fun triggerMusic() {
    val s = on.copy(trigger = AodTrigger.MUSIC)
    val p = AodPolicy()
    assertFalse(p.onScreenOff(s, locked))
    assertFalse(p.onScreenOff(s, locked.copy(charging = true)))
    assertTrue(p.onScreenOff(s, locked.copy(musicPlaying = true)))
  }

  // Off hours 22:00-07:00: shows nothing inside, shows outside; equal start and end means the schedule never blocks.
  @Test
  fun offHoursCrossMidnight() {
    val s = on.copy(schedule = AodSchedule(on = true, start = "22:00", end = "07:00"))
    val p = AodPolicy()
    fun at(h: Int, m: Int) = p.onScreenOff(s, locked.copy(minuteOfDay = h * 60 + m))
    assertFalse(at(22, 0))
    assertFalse(at(23, 59))
    assertFalse(at(0, 1))
    assertFalse(at(6, 59))
    assertTrue(at(7, 0))
    assertTrue(at(12, 0))
    assertTrue(at(21, 59))
    val same = on.copy(schedule = AodSchedule(on = true, start = "08:00", end = "08:00"))
    assertTrue(p.onScreenOff(same, locked.copy(minuteOfDay = 8 * 60)))
    val day = on.copy(schedule = AodSchedule(on = true, start = "09:00", end = "17:00"))
    assertFalse(p.onScreenOff(day, locked.copy(minuteOfDay = 12 * 60)))
    assertTrue(p.onScreenOff(day, locked.copy(minuteOfDay = 18 * 60)))
    val off = on.copy(schedule = AodSchedule(on = false, start = "00:00", end = "23:59"))
    assertTrue(p.onScreenOff(off, locked.copy(minuteOfDay = 60)))
  }

  @Test
  fun notificationWakeIgnoresTimedOut() {
    val p = AodPolicy()
    p.onTimedOut()
    assertFalse(p.onScreenOff(on, locked))
    assertTrue(p.onNotificationWake(on, locked, true))
    assertFalse(p.onNotificationWake(on, locked, false))
    assertFalse(p.onNotificationWake(on.copy(enabled = false), locked, true))
  }
}
