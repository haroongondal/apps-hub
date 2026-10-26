package expo.modules.opentunnelnative

import android.os.SystemClock

/**
 * Status names shared with the TS contract (`VpnStatusState`, plan §4.1).
 * Keeping the strings in one place makes the Kotlin writer and the JS
 * reader structurally comparable.
 */
object TunnelStatus {
  const val DISCONNECTED = "disconnected"
  const val CONNECTING = "connecting"
  const val CONNECTED = "connected"
  const val DISCONNECTING = "disconnecting"
  const val REASSERTING = "reasserting"
  const val ERROR = "error"

  val ALL: Set<String> =
    setOf(DISCONNECTED, CONNECTING, CONNECTED, DISCONNECTING, REASSERTING, ERROR)

  fun requireKnown(state: String) {
    require(state in ALL) { "unknown tunnel status $state" }
  }
}

/**
 * Process-wide tunnel status holder (plan §4.2). Survives activity
 * re-creation because it outlives the Activity; a process death resets it
 * to `disconnected` — the true state, since the tunnel config is never
 * persisted to disk (privacy rule #5).
 */
object TunnelStateRegistry {
  @Volatile
  var statusState: String = TunnelStatus.DISCONNECTED
    private set

  /** Native wording for failures; never inline keys, certs, or configs. */
  @Volatile
  var statusMessage: String? = null
    private set

  /**
   * elapsedRealtime anchor of the current connected period; null unless the
   * status is `connected`. Traffic duration derives from this (wall-clock
   * changes cannot distort it).
   */
  @Volatile
  var connectedAtMs: Long? = null
    private set

  fun setStatus(state: String, message: String? = null) {
    TunnelStatus.requireKnown(state)
    statusState = state
    statusMessage = message
    connectedAtMs =
      if (state == TunnelStatus.CONNECTED) SystemClock.elapsedRealtime() else null
  }
}
