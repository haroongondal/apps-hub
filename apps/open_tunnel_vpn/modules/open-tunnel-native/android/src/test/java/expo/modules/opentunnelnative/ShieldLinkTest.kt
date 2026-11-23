package expo.modules.opentunnelnative

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShieldLinkTest {
  private val off = ShieldState(on = false, untrusted = false, sinceMs = 1L)
  private val onTrusted = ShieldState(on = true, untrusted = false, sinceMs = 2L)
  private val onUntrusted = ShieldState(on = true, untrusted = true, sinceMs = 3L)

  @Test fun enteringAndLeavingAnUntrustedNetworkPingsAndRestartsSince() {
    val enter = ShieldLink.next(onTrusted, on = true, untrusted = true, nowMs = 10L)
    assertEquals(ShieldState(true, true, 10L), enter.state)
    assertTrue(enter.ping)
    val leave = ShieldLink.next(enter.state, on = true, untrusted = false, nowMs = 20L)
    assertEquals(ShieldState(true, false, 20L), leave.state)
    assertTrue(leave.ping)
  }

  @Test fun theSameStateAgainKeepsSinceAndSendsNothing() {
    val again = ShieldLink.next(onUntrusted, on = true, untrusted = true, nowMs = 99L)
    assertEquals(onUntrusted, again.state)
    assertFalse(again.ping)
    assertFalse(ShieldLink.next(off, on = false, untrusted = true, nowMs = 99L).ping)
  }

  @Test fun withShieldsOffTheNetworkIsNeverRecordedOrPinged() {
    val step = ShieldLink.next(off, on = false, untrusted = true, nowMs = 5L)
    assertEquals(off, step.state)
    assertFalse(step.ping)
  }

  @Test fun switchingShieldsPingsOnlyWhenThePulseFlips() {
    assertTrue(ShieldLink.next(off, on = true, untrusted = true, nowMs = 5L).ping)
    assertFalse(ShieldLink.next(off, on = true, untrusted = false, nowMs = 5L).ping)
    assertTrue(ShieldLink.next(onUntrusted, on = false, untrusted = true, nowMs = 5L).ping)
    val quiet = ShieldLink.next(onTrusted, on = false, untrusted = false, nowMs = 5L)
    assertFalse(quiet.ping)
    assertEquals(ShieldState(false, false, 5L), quiet.state)
  }

  @Test fun theFirstPublishStartsSinceAndPingsOnlyForAPulse() {
    assertEquals(ShieldLink.Step(ShieldState(true, true, 7L), true), ShieldLink.next(null, on = true, untrusted = true, nowMs = 7L))
    assertEquals(ShieldLink.Step(ShieldState(false, false, 7L), false), ShieldLink.next(null, on = false, untrusted = false, nowMs = 7L))
  }

  @Test fun rowsOnlyWhileShieldsIsOn() {
    assertTrue(ShieldLink.shieldRows(null).isEmpty())
    assertTrue(ShieldLink.shieldRows(off).isEmpty())
    assertArrayEquals(arrayOf<Any?>(1, 1, 3L), ShieldLink.shieldRows(onUntrusted).single())
    assertArrayEquals(arrayOf<Any?>(1, 0, 2L), ShieldLink.shieldRows(onTrusted).single())
  }

  @Test fun theHealthRowSaysNoAccessibilityNoListenerNoAi() {
    assertArrayEquals(arrayOf<Any?>("open-tunnel", null, null, "none", 42L), ShieldLink.healthRows(42L).single())
    assertArrayEquals(arrayOf<Any?>("open-tunnel", null, null, "none", null), ShieldLink.healthRows(null).single())
  }
}
