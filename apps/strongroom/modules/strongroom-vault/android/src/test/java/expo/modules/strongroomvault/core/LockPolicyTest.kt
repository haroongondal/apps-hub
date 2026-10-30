package expo.modules.strongroomvault.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LockPolicyTest {
  @Test fun expiresAfterTimeout() {
    assertTrue(LockPolicy.expired(0, 5 * 60_000, 5))
    assertFalse(LockPolicy.expired(0, 5 * 60_000 - 1, 5))
    assertTrue(LockPolicy.expired(60_000, 2 * 60_000, 1))
    assertFalse(LockPolicy.expired(60_000, 2 * 60_000 - 1, 1))
  }

  @Test fun aClockThatMovedBackwardsCountsAsExpired() {
    assertTrue(LockPolicy.expired(10, 5, 5))
  }

  @Test fun biometricNeedsPasswordUnlockThisBoot() {
    assertFalse(LockPolicy.biometricAllowed(true, 7, 8))
    assertTrue(LockPolicy.biometricAllowed(true, 8, 8))
    assertFalse(LockPolicy.biometricAllowed(false, 8, 8))
    assertFalse(LockPolicy.biometricAllowed(true, null, 8))
  }

  @Test fun onlyOneFiveAndFifteenMinutesAreValid() {
    for (m in listOf(1, 5, 15)) assertTrue("$m", LockPolicy.validTimeout(m))
    for (m in listOf(-5, 0, 2, 4, 10, 16, 60)) assertFalse("$m", LockPolicy.validTimeout(m))
  }
}
