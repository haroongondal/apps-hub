package expo.modules.opentunnelnative

data class ShieldState(val on: Boolean, val untrusted: Boolean, val sinceMs: Long)

/** The shield and health shares (packages/open-tunnel-core/src/shield-share.ts); TunnelLinkProviderShareTest binds them to the fixtures. */
object ShieldLink {
  const val AUTHORITY = "com.haroon.opentunnel.applink"
  const val SHIELD_PATH = "shield"
  internal val SHIELD_COLUMNS = arrayOf("on", "untrusted_now", "since")
  internal const val SHIELD_LIMIT = 1
  const val HEALTH_PATH = "health"
  internal val HEALTH_COLUMNS = arrayOf("app_id", "accessibility", "listener", "ai_source", "last_seen_at")
  internal const val HEALTH_LIMIT = 1
  const val APP_ID = "open-tunnel"

  data class Step(val state: ShieldState, val ping: Boolean)

  // Halo pulses only while Shields is on and the network is not trusted, so only a flip of that is worth a ping.
  fun next(prev: ShieldState?, on: Boolean, untrusted: Boolean, nowMs: Long): Step {
    val kept = on && untrusted
    val same = prev != null && prev.on == on && prev.untrusted == kept
    val state = if (same) prev!! else ShieldState(on, kept, nowMs)
    return Step(state, pulse(prev) != pulse(state))
  }

  private fun pulse(state: ShieldState?) = state?.on == true && state.untrusted

  fun shieldRows(state: ShieldState?): List<Array<Any?>> =
    if (state?.on == true) listOf(arrayOf(1, if (state.untrusted) 1 else 0, state.sinceMs)) else emptyList()

  fun healthRows(lastSeenAtMs: Long?): List<Array<Any?>> = listOf(arrayOf(APP_ID, null, null, "none", lastSeenAtMs))
}
