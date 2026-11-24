package expo.modules.clipboardcore.android

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import expo.modules.clipboardcore.applink.AppLinkCaller
import expo.modules.clipboardcore.core.ClipLinks

class ClipLinkProvider : ContentProvider() {
  override fun onCreate() = true

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
    val c = context ?: throw SecurityException("Not a signed sibling app")
    if (!AppLinkCaller.allowed(c)) throw SecurityException("Not a signed sibling app")
    // Binder thread only: off it there is no caller. A package that does not match the calling uid throws, so no reader.
    val caller = runCatching { callingPackage }.getOrNull()
    if (uri.authority != ClipLinks.AUTHORITY) throw IllegalArgumentException("Unknown share")
    val store = ClipStore.get(c)
    if (uri.pathSegments == listOf(ClipLinks.HEALTH_PATH)) {
      return cursor(ClipLinks.HEALTH_COLUMNS, listOf(ClipLinks.health(CaptureService.isEnabled(c), store.lastSeenAt())))
    }
    val since = ClipLinks.pinnedSince(uri.pathSegments) ?: throw IllegalArgumentException("Unknown share")
    return cursor(ClipLinks.PINNED_COLUMNS, if (ClipLinks.pinnedReader(store.nexusReadsPinned(), caller)) store.pinnedRows(since) else emptyList())
  }

  private fun cursor(columns: Array<String>, rows: List<Array<Any?>>) = MatrixCursor(columns, rows.size).apply { rows.forEach(::addRow) }

  override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException("Read-only")
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun getType(uri: Uri): String? = null
}
