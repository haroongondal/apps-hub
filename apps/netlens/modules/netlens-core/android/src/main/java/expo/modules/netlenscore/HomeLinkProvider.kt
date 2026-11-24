package expo.modules.netlenscore

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import expo.modules.netlenscore.applink.AppLinkCaller

// Read-only E1 shares (packages/core/src/home-shares.ts) and the health row (appHealthShare('netlens')); HomeLinkProviderShareTest binds the columns to the fixtures.
class HomeLinkProvider : ContentProvider() {
  override fun onCreate() = true

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
    val ctx = context
    if (ctx == null || !AppLinkCaller.allowed(ctx)) throw SecurityException("Not a signed sibling app")
    val (columns, rows) = when (uri.pathSegments) {
      // Reads the heartbeat, never writes it: last_seen_at says when HomeNet last ran, not when it was asked.
      listOf(HomeShareRows.HEALTH_PATH) -> HomeShareRows.HEALTH_COLUMNS to HomeShareRows.health(HomeWatchStore.lastSeenAt(ctx))
      listOf(HomeShareRows.WHO_IS_HOME_PATH) -> HomeShareRows.WHO_IS_HOME_COLUMNS to HomeShareRows.whoIsHome(HomeWatchStore.load(ctx))
      listOf(HomeShareRows.NEW_DEVICES_PATH) -> HomeShareRows.NEW_DEVICES_COLUMNS to HomeShareRows.newDevices(HomeWatchStore.load(ctx))
      else -> throw IllegalArgumentException("Unknown share path")
    }
    return MatrixCursor(columns, rows.size).also { cursor -> rows.forEach(cursor::addRow) }
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException("Read-only")
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun getType(uri: Uri): String? = null
}
