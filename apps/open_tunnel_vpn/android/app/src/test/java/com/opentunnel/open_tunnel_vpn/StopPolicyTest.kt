package com.opentunnel.open_tunnel_vpn

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StopPolicyTest {

  @Test
  fun runsTheStopWhenNoStopIsInFlight() {
    assertTrue(StopPolicy.shouldRunStop(null, 7L))
  }

  @Test
  fun ignoresATapWhileAStopRunIsInFlight() {
    // The in-flight run owns the engine stop and the final `disconnected`
    // post; a second run would only repeat the up-to-3 s wait behind it.
    assertFalse(StopPolicy.shouldRunStop(7L, 7L))
  }

  @Test
  fun runsAStopThatANewerStartMadeStale() {
    // A start claimed the tunnel after the in-flight run was accepted: that
    // run's tail will skip, so the fresh tap must stop the current tunnel.
    assertTrue(StopPolicy.shouldRunStop(3L, 9L))
  }
}
