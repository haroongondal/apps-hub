package com.opentunnel.open_tunnel_vpn

/**
 * Power-off tap decisions (pure; JVM-tested). The exactly-once rule needs a
 * testable home outside the service: one stop run owns the engine stop and
 * the final `disconnected` post for its tunnel generation.
 */
object StopPolicy {

  /**
   * A repeated ACTION_STOP for the same tunnel generation changes nothing:
   * the in-flight run already owns the engine stop and the final
   * `disconnected` post, so a second run (another up-to-3 s engine-stop
   * wait) must never queue behind it. But a stop for a NEWER generation —
   * a start claimed the tunnel after the in-flight run was accepted — must
   * run: the in-flight run is stale (its tail will skip) and the fresh tap
   * stops the tunnel the user sees now.
   */
  fun shouldRunStop(inFlightGeneration: Long?, requestGeneration: Long): Boolean =
    inFlightGeneration == null || inFlightGeneration != requestGeneration
}
