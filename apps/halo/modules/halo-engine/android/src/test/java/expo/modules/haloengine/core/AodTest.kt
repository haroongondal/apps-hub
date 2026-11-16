package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Test

class AodTest {
  @Test
  fun launchesOnlyWhenTheSwitchIsOnAndThePhoneIsLocked() {
    assertEquals(true, Aod.shouldLaunch(spikeOn = true, keyguardLocked = true, shownSinceUnlock = false))
    assertEquals(false, Aod.shouldLaunch(spikeOn = true, keyguardLocked = false, shownSinceUnlock = false))
    assertEquals(false, Aod.shouldLaunch(spikeOn = false, keyguardLocked = true, shownSinceUnlock = false))
    assertEquals(false, Aod.shouldLaunch(spikeOn = false, keyguardLocked = false, shownSinceUnlock = false))
  }

  // The clock turns the screen on, so relaunching on the next screen-off would keep the screen on for ever.
  @Test
  fun launchesOncePerLock() {
    assertEquals(false, Aod.shouldLaunch(spikeOn = true, keyguardLocked = true, shownSinceUnlock = true))
  }
}
