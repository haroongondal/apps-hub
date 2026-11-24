package expo.modules.haloengine.core

/** Halo's row in the app health share (appHealthShare('halo')); HaloHealthTest binds it to the contract fixture. Halo has no AI, so ai_source is always none. */
object HaloHealth {
  const val AUTHORITY = "com.haroon.halo.applink"
  const val PATH = "health"
  const val APP_ID = "halo"
  internal val COLUMNS = arrayOf("app_id", "accessibility", "listener", "ai_source", "last_seen_at")
  internal const val MAX_ROWS = 1

  fun row(accessibility: Boolean, listener: Boolean, lastSeenAt: Long?): Array<Any?> =
    arrayOf(APP_ID, if (accessibility) 1 else 0, if (listener) 1 else 0, "none", lastSeenAt)
}
