package com.opentunnel.open_tunnel_vpn

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StopPolicyTest {

  @Test
  fun runsTheStopWhenNoStopIsInFlight() {
    assertTrue(StopPolicy.shouldRunStop(false))
  }

  @Test
  fun ignoresATapWhileAStopRunIsInFlight() {
    // The in-flight run owns the engine stop and the final `disconnected`
    // post; a second run would only repeat the up-to-3 s wait behind it.
    assertFalse(StopPolicy.shouldRunStop(true))
  }
}
