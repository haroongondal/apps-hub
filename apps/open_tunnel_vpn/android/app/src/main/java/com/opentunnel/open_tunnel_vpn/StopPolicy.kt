package com.opentunnel.open_tunnel_vpn

/**
 * Power-off tap decisions (pure; JVM-tested). The exactly-once rule needs a
 * testable home outside the service: one stop run owns the engine stop and
 * the final `disconnected` post, and a repeated tap changes nothing.
 */
object StopPolicy {

  /**
   * A repeated ACTION_STOP while a stop run is in flight changes nothing:
   * the running run already posts the final `disconnected`, so a second run
   * (another up-to-3 s engine-stop wait) must never start behind it.
   */
  fun shouldRunStop(stopInFlight: Boolean): Boolean = !stopInFlight
}
