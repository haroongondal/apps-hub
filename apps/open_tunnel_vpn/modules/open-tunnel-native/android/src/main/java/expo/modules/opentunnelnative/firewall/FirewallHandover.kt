package expo.modules.opentunnelnative.firewall

/**
 * Pure rule for handing the VPN slot from the firewall to a server connection. `running` is the
 * `firewall_state` value the `:firewall` process writes: "true" while the firewall is up. The caller passes
 * a monotonic clock for `nowMs` and `startedAtMs`.
 *
 * A server connection never fails because the firewall held the slot: once [STOP_TIMEOUT_MS] has passed the
 * engine starts whatever `running` says, and [shouldForceStop] tells the caller to stop the firewall service
 * itself first.
 */
object FirewallHandover {

  const val STOP_TIMEOUT_MS: Long = 3_000
  const val POLL_MS: Long = 100

  private fun timedOut(nowMs: Long, startedAtMs: Long, timeoutMs: Long) = nowMs - startedAtMs >= timeoutMs

  fun canStartEngine(running: String?, nowMs: Long, startedAtMs: Long, timeoutMs: Long): Boolean =
    running != "true" || timedOut(nowMs, startedAtMs, timeoutMs)

  fun shouldForceStop(running: String?, nowMs: Long, startedAtMs: Long, timeoutMs: Long): Boolean =
    running == "true" && timedOut(nowMs, startedAtMs, timeoutMs)

  /**
   * Not only while it reports running: a restore START may still be queued or building its tun, and `running`
   * turns "true" only once the tun is up. A STOP sent now is delivered after that START.
   */
  fun shouldStopFirewall(running: String?, enabled: String?): Boolean = running == "true" || enabled == "true"

  /** `enabled` is the `firewall_state` value the user's switch writes. */
  fun shouldRestartAfterEngine(enabled: String?): Boolean = enabled == "true"
}
