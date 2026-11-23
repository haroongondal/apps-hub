package expo.modules.opentunnelnative

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import expo.modules.opentunnelnative.applink.AppLinkCaller

class TunnelLinkProvider : ContentProvider() {
  override fun onCreate() = true

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
    val ctx = context
    if (ctx == null || !AppLinkCaller.allowed(ctx)) throw SecurityException("Not a signed sibling app")
    val (columns, rows) = when (uri.pathSegments) {
      listOf(ShieldLink.SHIELD_PATH) -> ShieldLink.SHIELD_COLUMNS to ShieldLink.shieldRows(TunnelLinkStore.shield(ctx))
      listOf(ShieldLink.HEALTH_PATH) -> ShieldLink.HEALTH_COLUMNS to ShieldLink.healthRows(TunnelLinkStore.lastSeenAt(ctx))
      else -> throw IllegalArgumentException("Unknown share path")
    }
    return MatrixCursor(columns, rows.size).also { cursor -> rows.forEach(cursor::addRow) }
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException("Read-only")
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun getType(uri: Uri): String? = null
}
