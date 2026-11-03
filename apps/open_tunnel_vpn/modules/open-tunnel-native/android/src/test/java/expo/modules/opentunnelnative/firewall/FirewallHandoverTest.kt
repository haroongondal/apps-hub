package expo.modules.opentunnelnative.firewall

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FirewallHandoverTest {

  private val started = 10_000L
  private val timeout = FirewallHandover.STOP_TIMEOUT_MS

  @Test
  fun startsNowWhenTheFirewallReportsStopped() {
    assertTrue(FirewallHandover.canStartEngine("false", started, started, timeout))
    assertFalse(FirewallHandover.shouldForceStop("false", started, started, timeout))
  }

  @Test
  fun startsNowWhenThereIsNoFirewallState() {
    // The firewall never ran, so there is nothing to wait for.
    assertTrue(FirewallHandover.canStartEngine(null, started, started, timeout))
    assertFalse(FirewallHandover.shouldForceStop(null, started, started, timeout))
  }

  @Test
  fun waitsWhileTheFirewallIsRunningWithinTheTimeout() {
    assertFalse(FirewallHandover.canStartEngine("true", started, started, timeout))
    assertFalse(FirewallHandover.canStartEngine("true", started + timeout - 1, started, timeout))
    assertFalse(FirewallHandover.shouldForceStop("true", started + timeout - 1, started, timeout))
  }

  @Test
  fun forcesTheStopAndStartsAnywayAfterTheTimeout() {
    val now = started + timeout
    assertTrue(FirewallHandover.shouldForceStop("true", now, started, timeout))
    assertTrue(FirewallHandover.canStartEngine("true", now, started, timeout))
    assertEquals(3_000L, timeout)
  }

  @Test
  fun neverForcesAStopWhenTheFirewallIsNotRunningEvenAfterTheTimeout() {
    val now = started + timeout
    assertTrue(FirewallHandover.canStartEngine("false", now, started, timeout))
    assertFalse(FirewallHandover.shouldForceStop("false", now, started, timeout))
    assertTrue(FirewallHandover.canStartEngine(null, now, started, timeout))
    assertFalse(FirewallHandover.shouldForceStop(null, now, started, timeout))
  }

  @Test
  fun stopsTheFirewallWheneverItsSwitchIsOnEvenIfItDoesNotReportRunning() {
    // A restore START may still be queued or building its tun: running is not "true" yet.
    assertTrue(FirewallHandover.shouldStopFirewall("false", "true"))
    assertTrue(FirewallHandover.shouldStopFirewall(null, "true"))
    assertTrue(FirewallHandover.shouldStopFirewall("true", "true"))
  }

  @Test
  fun stopsARunningFirewallWhoseSwitchIsGoingOff() {
    assertTrue(FirewallHandover.shouldStopFirewall("true", "false"))
    assertTrue(FirewallHandover.shouldStopFirewall("true", null))
  }

  @Test
  fun sendsNoStopWhenTheFirewallIsOffAndNotRunning() {
    assertFalse(FirewallHandover.shouldStopFirewall("false", "false"))
    assertFalse(FirewallHandover.shouldStopFirewall(null, null))
  }

  @Test
  fun restartsTheFirewallOnlyWhenItIsEnabled() {
    assertTrue(FirewallHandover.shouldRestartAfterEngine("true"))
    assertFalse(FirewallHandover.shouldRestartAfterEngine("false"))
    assertFalse(FirewallHandover.shouldRestartAfterEngine(null))
  }
}
