package expo.modules.haloengine.android

import android.app.NotificationManager
import android.content.ComponentName
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.provider.Settings
import expo.modules.haloengine.applink.AppLinkCaller
import expo.modules.haloengine.core.HaloHealth
import expo.modules.notchisland.android.NotchAccessibilityService
import expo.modules.notchisland.core.serviceEnabled

/** Halo's one share: its health row for the Store. Read-only; a query never writes, not even the heartbeat. */
class HaloLinkProvider : ContentProvider() {
  override fun onCreate() = true

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
    val c = context ?: throw SecurityException("Not a signed sibling app")
    if (!AppLinkCaller.allowed(c)) throw SecurityException("Not a signed sibling app")
    if (uri.authority != HaloHealth.AUTHORITY || uri.pathSegments != listOf(HaloHealth.PATH)) throw IllegalArgumentException("Unknown share")
    val row = HaloHealth.row(accessibility(c), listener(c), Heartbeat.lastSeenAt(c))
    return MatrixCursor(HaloHealth.COLUMNS).apply { addRow(row) }
  }

  private fun accessibility(c: Context) = runCatching {
    serviceEnabled(Settings.Secure.getString(c.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES), c.packageName, NotchAccessibilityService::class.java.name)
  }.getOrDefault(false)

  private fun listener(c: Context) = runCatching {
    c.getSystemService(NotificationManager::class.java).isNotificationListenerAccessGranted(ComponentName(c, HaloListener::class.java))
  }.getOrDefault(false)

  override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException("Read-only")
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun getType(uri: Uri): String? = null
}

/** When Halo last ran (epoch ms): written on service start and app open, read by the health row. */
object Heartbeat {
  private const val FILE = "applink"
  private const val KEY = "last_seen_at"

  fun beat(ctx: Context) {
    ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putLong(KEY, System.currentTimeMillis()).apply()
  }

  fun lastSeenAt(ctx: Context): Long? =
    ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).let { if (it.contains(KEY)) it.getLong(KEY, 0L) else null }
}
