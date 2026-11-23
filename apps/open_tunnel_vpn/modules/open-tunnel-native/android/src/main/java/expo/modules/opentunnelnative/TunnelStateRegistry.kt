package expo.modules.opentunnelnative

import android.content.Context
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

  /** Typed failure code (TS contract `OPEN_TUNNEL_ERROR_CODES`) when the
   * failure carries one; null otherwise, and the event omits the key. */
  @Volatile
  var statusCode: String? = null
    private set

  /**
   * elapsedRealtime anchor of the current connected period; null unless the
   * status is `connected`. Traffic duration derives from this (wall-clock
   * changes cannot distort it).
   */
  @Volatile
  var connectedAtMs: Long? = null
    private set

  /** OpenTunnelVpnService holds its blocking interface (kill switch). */
  @Volatile
  var blocking: Boolean = false
    private set

  /** VpnService.isAlwaysOn and isLockdownEnabled as the service last read them; null until it ran in this process. */
  @Volatile
  var alwaysOn: Boolean? = null
    private set

  @Volatile
  var lockdown: Boolean? = null
    private set

  // Set by the module and the VPN service so every status change refreshes the health heartbeat.
  @Volatile
  private var appContext: Context? = null

  fun attach(context: Context) {
    appContext = context.applicationContext
  }

  fun setBlocking(value: Boolean) {
    blocking = value
  }

  fun setLockdown(alwaysOn: Boolean, lockdown: Boolean) {
    this.alwaysOn = alwaysOn
    this.lockdown = lockdown
  }

  fun setStatus(state: String, message: String? = null, code: String? = null) {
    TunnelStatus.requireKnown(state)
    statusState = state
    statusMessage = message
    statusCode = code
    connectedAtMs =
      if (state == TunnelStatus.CONNECTED) SystemClock.elapsedRealtime() else null
    appContext?.let { TunnelLinkStore.heartbeat(it, System.currentTimeMillis()) }
  }
}
