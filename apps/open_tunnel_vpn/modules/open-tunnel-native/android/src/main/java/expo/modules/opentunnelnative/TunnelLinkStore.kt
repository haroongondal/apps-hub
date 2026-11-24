package expo.modules.opentunnelnative

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import expo.modules.opentunnelnative.applink.AppLinkGuard
import expo.modules.opentunnelnative.applink.AppLinkTarget
import expo.modules.opentunnelnative.applink.SiblingPackages

private const val PREFS = "applink"
private const val KEY_ON = "shield_on"
private const val KEY_UNTRUSTED = "shield_untrusted"
private const val KEY_SINCE = "shield_since"
private const val KEY_LAST_SEEN = "last_seen_at"
private const val CHANGED_ACTION = "com.haroon.autopilot.CHANGED"

/** What the link provider serves: the Shields state and the heartbeat. Only this app writes it; a provider query only reads. */
object TunnelLinkStore {
  @Volatile private var watching = false
  @Volatile private var reported = false

  /** Process-level: true only while the watch is registered AND a Shields-on publish has followed its start, so a saved row from before is never served as current. */
  val networkWatched: Boolean get() = watching && reported

  fun watchStarted() {
    reported = false
    watching = true
  }

  fun watchStopped() {
    watching = false
    reported = false
  }

  // App.tsx publishes Shields on only once it has read a network, so that publish is the first live reading.
  internal fun noteShield(on: Boolean) {
    if (on) reported = true
  }

  private fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun shield(context: Context): ShieldState? {
    val p = prefs(context)
    if (!p.contains(KEY_SINCE)) return null
    return ShieldState(p.getBoolean(KEY_ON, false), p.getBoolean(KEY_UNTRUSTED, false), p.getLong(KEY_SINCE, 0L))
  }

  fun lastSeenAt(context: Context): Long? = prefs(context).let { if (it.contains(KEY_LAST_SEEN)) it.getLong(KEY_LAST_SEEN, 0L) else null }

  fun heartbeat(context: Context, nowMs: Long) {
    prefs(context).edit().putLong(KEY_LAST_SEEN, nowMs).apply()
  }

  // Synchronized: two calls must not both read the old state, or the pulse flip (and its ping) is lost or doubled.
  @Synchronized
  fun publishShield(context: Context, on: Boolean, untrusted: Boolean, nowMs: Long) {
    val step = ShieldLink.next(shield(context), on, untrusted, nowMs)
    check(
      prefs(context).edit()
        .putBoolean(KEY_ON, step.state.on)
        .putBoolean(KEY_UNTRUSTED, step.state.untrusted)
        .putLong(KEY_SINCE, step.state.sinceMs)
        .commit(),
    ) { "Shields state not saved" }
    noteShield(on)
    if (step.ping) {
      val intent = Intent(CHANGED_ACTION).setPackage(SiblingPackages.HALO)
      sendIfTrusted({ AppLinkTarget.trustedReceiver(context, intent) }) { context.sendBroadcast(intent, AppLinkGuard.PERMISSION) }
    }
  }

  /** The state is already saved; only the ping is gated. A lookalike Halo (or none) gets nothing, and there is no fallback. */
  internal fun sendIfTrusted(trusted: () -> Boolean, send: () -> Unit) {
    if (trusted()) send()
  }
}
