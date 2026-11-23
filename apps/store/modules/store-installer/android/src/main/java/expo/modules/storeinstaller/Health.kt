package expo.modules.storeinstaller

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.provider.Settings

object Health {
  private const val LISTENERS = "enabled_notification_listeners"
  private const val PATH = "health"
  private const val MAX_ROWS = 2
  const val TIMEOUT_MS = 3_000L

  fun settings(context: Context): Map<String, String?> = mapOf(
    "accessibility" to secure(context, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES),
    "listeners" to secure(context, LISTENERS),
  )

  private fun secure(context: Context, name: String): String? = try {
    Settings.Secure.getString(context.contentResolver, name)
  } catch (e: SecurityException) {
    null
  }

  suspend fun report(context: Context, authority: String): List<Map<String, Any?>>? =
    Deadline.within(TIMEOUT_MS) { rows(context, authority) }

  // Any failure (no provider yet, a debug build refused by the signature check, a broken provider) is "no report".
  private fun rows(context: Context, authority: String): List<Map<String, Any?>>? = try {
    context.contentResolver.query(Uri.parse("content://$authority/$PATH"), null, null, null, null)?.use { c ->
      buildList { while (size < MAX_ROWS && c.moveToNext()) add(row(c)) }
    }
  } catch (e: Exception) {
    null
  }

  private fun row(c: Cursor): Map<String, Any?> = buildMap {
    for (i in 0 until c.columnCount) {
      when (c.getType(i)) {
        Cursor.FIELD_TYPE_NULL -> put(c.getColumnName(i), null)
        Cursor.FIELD_TYPE_INTEGER -> put(c.getColumnName(i), c.getLong(i).toDouble())
        Cursor.FIELD_TYPE_FLOAT -> put(c.getColumnName(i), c.getDouble(i))
        Cursor.FIELD_TYPE_STRING -> put(c.getColumnName(i), c.getString(i))
      }
    }
  }

  fun openAppSettings(context: Context, packageName: String) =
    start(context, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))

  // The per-service accessibility page is not public SDK, so open the list.
  fun openAccessibilitySettings(context: Context) = start(context, Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))

  fun openListenerSettings(context: Context, packageName: String, className: String?) {
    val list = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
    if (className == null || Build.VERSION.SDK_INT < 30) return start(context, list)
    val detail = Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
      .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, ComponentName(packageName, className).flattenToString())
    try {
      start(context, detail)
    } catch (e: ActivityNotFoundException) {
      start(context, list)
    }
  }

  private fun start(context: Context, intent: Intent) = context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
