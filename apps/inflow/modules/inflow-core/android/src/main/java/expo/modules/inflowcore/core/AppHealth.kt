package expo.modules.inflowcore.core

/**
 * The `health` row the Store reads: whether Inflow's listener is on, where its AI keys come from, and when the app last ran.
 * No personal data. Only [beat] writes; reading and building the row never do.
 */
object AppHealth {
  const val APP_ID = "inflow"
  const val META_LAST_SEEN = "healthLastSeenAt"

  // Equal to the columns of appHealthShare in packages/app-link-contract/src/health.ts (fixtures/app-health.share.json).
  val COLUMNS = arrayOf("app_id", "accessibility", "listener", "ai_source", "last_seen_at")

  /** Inflow has no accessibility service (null) and no AI hub client, so ai_source is 'own' when a key is saved and 'none' otherwise. */
  fun row(listenerEnabled: Boolean, anyKeySaved: Boolean, lastSeenAt: Long?): Array<Any?> =
    arrayOf(APP_ID, null, if (listenerEnabled) 1 else 0, if (anyKeySaved) "own" else "none", lastSeenAt)

  fun beat(store: ItemStore, now: Long) = store.setMeta(META_LAST_SEEN, now.toString())

  fun lastSeen(store: ItemStore): Long? = store.meta(META_LAST_SEEN)?.toLongOrNull()
}
