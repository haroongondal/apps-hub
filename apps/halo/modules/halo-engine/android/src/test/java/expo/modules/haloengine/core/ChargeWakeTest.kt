package expo.modules.haloengine.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChargeWakeTest {
  private fun wake(
    screenOn: Boolean = false,
    aodShowing: Boolean = false,
    aodEnabled: Boolean = true,
    wakeOnCharge: Boolean = true,
    near: Boolean? = false,
    plugIn: Boolean = true,
  ) = shouldWakeForCharge(screenOn, aodShowing, aodEnabled, wakeOnCharge, near, plugIn)

  @Test
  fun wakesOnPlugInWithTheScreenDarkAndNothingNear() {
    assertTrue(wake())
  }

  @Test
  fun neverOnUnplug() {
    assertFalse(wake(plugIn = false))
    assertFalse(ChargeWake.wanted(plugIn = false, screenOn = false, aodShowing = false, aodEnabled = true, wakeOnCharge = true))
  }

  @Test
  fun neverWhenTheAlwaysOnScreenAlreadyShows() {
    assertFalse(wake(aodShowing = true))
  }

  @Test
  fun neverWhenTheScreenIsOn() {
    assertFalse(wake(screenOn = true))
  }

  @Test
  fun neverWhenNearOrUnknown() {
    assertFalse(wake(near = true))
    assertFalse(wake(near = null))
  }

  @Test
  fun neverWhenASettingIsOff() {
    assertFalse(wake(aodEnabled = false))
    assertFalse(wake(wakeOnCharge = false))
  }

  @Test
  fun wantedSkipsTheSensorWhenTheAnswerIsAlreadyNo() {
    assertTrue(ChargeWake.wanted(plugIn = true, screenOn = false, aodShowing = false, aodEnabled = true, wakeOnCharge = true))
    assertFalse(ChargeWake.wanted(plugIn = true, screenOn = false, aodShowing = false, aodEnabled = false, wakeOnCharge = true))
    assertFalse(ChargeWake.wanted(plugIn = true, screenOn = true, aodShowing = false, aodEnabled = true, wakeOnCharge = true))
  }
}
