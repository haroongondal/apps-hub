package expo.modules.strongroomvault.android

import android.content.Context

// The `health` row (packages/app-link-contract, appHealthShare('strongroom')): no personal data, served whatever the expiry switch says.
// Strongroom fills through the autofill service, so accessibility and listener are null.
internal object AppHealth {
  internal const val PATH = "health"
  internal const val APP_ID = "strongroom"
  internal val COLUMNS = arrayOf("app_id", "accessibility", "listener", "ai_source", "last_seen_at")
  private const val KEY = "lastSeenAt"

  // Written when the app opens or the autofill service starts; a query only reads it.
  fun beat(context: Context, now: Long = System.currentTimeMillis()) = VaultHolder.prefs(context).edit().putLong(KEY, now).apply()

  fun lastSeen(context: Context): Long? = VaultHolder.prefs(context).takeIf { it.contains(KEY) }?.getLong(KEY, 0L)

  fun row(lastSeenAt: Long?): Array<Any?> = arrayOf(APP_ID, null, null, "none", lastSeenAt)
}
