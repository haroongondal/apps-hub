package expo.modules.inflowcore.core

/**
 * The `health` row the Store reads: whether Inflow's listener is on, where its AI comes from, and when the app last ran.
 * No personal data. Only [beat] writes; reading and building the row never does.
 */
object AppHealth {
  const val APP_ID = "inflow"
  const val META_LAST_SEEN = "healthLastSeenAt"

  // Equal to the columns of appHealthShare in packages/app-link-contract/src/health.ts (fixtures/app-health.share.json).
  val COLUMNS = arrayOf("app_id", "accessibility", "listener", "ai_source", "last_seen_at")

  /** No accessibility service (null). ai_source is 'hub' while AI is on (AI hub is Inflow's only AI) and 'none' while it is off. */
  fun row(listenerEnabled: Boolean, aiOn: Boolean, lastSeenAt: Long?): Array<Any?> =
    arrayOf(APP_ID, null, if (listenerEnabled) 1 else 0, if (aiOn) "hub" else "none", lastSeenAt)

  fun beat(store: ItemStore, now: Long) = store.setMeta(META_LAST_SEEN, now.toString())

  fun lastSeen(store: ItemStore): Long? = store.meta(META_LAST_SEEN)?.toLongOrNull()
}
