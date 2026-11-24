package expo.modules.inflowcore.core

/**
 * The `health` row the Store reads: whether Inflow's listener is on, where its AI keys come from, and when the app last ran.
 * No personal data. Only [beat] and [record] write; reading and building the row never do.
 */
object AppHealth {
  const val APP_ID = "inflow"
  const val META_LAST_SEEN = "healthLastSeenAt"

  // Equal to the columns of appHealthShare in packages/app-link-contract/src/health.ts (fixtures/app-health.share.json).
  val COLUMNS = arrayOf("app_id", "accessibility", "listener", "ai_source", "last_seen_at")

  const val META_AI_SOURCE = "aiSource"

  /** No accessibility service (null). ai_source is what carried the last successful AI call (hub or own), 'own' before any, and 'none' without a key (AI is off). */
  fun row(listenerEnabled: Boolean, anyKeySaved: Boolean, lastSeenAt: Long?, recordedSource: String? = null): Array<Any?> =
    arrayOf(APP_ID, null, if (listenerEnabled) 1 else 0, aiSource(anyKeySaved, recordedSource), lastSeenAt)

  fun aiSource(anyKeySaved: Boolean, recorded: String?): String =
    if (!anyKeySaved) "none" else recorded?.takeIf { it == HubFirst.HUB || it == HubFirst.OWN } ?: HubFirst.OWN

  /** Writes only when the source changes, so a run of batches is one write at most. */
  fun record(store: ItemStore, source: String) {
    if (store.meta(META_AI_SOURCE) != source) store.setMeta(META_AI_SOURCE, source)
  }

  fun beat(store: ItemStore, now: Long) = store.setMeta(META_LAST_SEEN, now.toString())

  fun lastSeen(store: ItemStore): Long? = store.meta(META_LAST_SEEN)?.toLongOrNull()
}
