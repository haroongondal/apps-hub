package expo.modules.designmedia.android

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import expo.modules.designmedia.applink.AppLinkCaller
import expo.modules.designmedia.core.AppHealth
import expo.modules.designmedia.core.AtomicFile
import java.io.File

// Serves only the health row (appHealthShare('design-editor')); a query reads the heartbeat and never writes it.
class DesignLinkProvider : ContentProvider() {
  override fun onCreate() = true

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
    val ctx = context
    if (ctx == null || !AppLinkCaller.allowed(ctx)) throw SecurityException("Not a signed sibling app")
    if (uri.pathSegments != listOf(AppHealth.PATH)) throw IllegalArgumentException("Unknown share path")
    val rows = AppHealth.rows(Heartbeat.text(ctx, AppHealth.AI_SOURCE_FILE), Heartbeat.text(ctx, AppHealth.HEARTBEAT_FILE))
    return MatrixCursor(AppHealth.COLUMNS, rows.size).also { cursor -> rows.forEach(cursor::addRow) }
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException("Read-only")
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun getType(uri: Uri): String? = null
}

object Heartbeat {
  // shortcut: a failed write is dropped, so the row shows an older time; nothing else depends on it.
  fun touch(ctx: Context) {
    runCatching { AtomicFile(File(ctx.filesDir, AppHealth.HEARTBEAT_FILE)).write(System.currentTimeMillis().toString()) }
  }

  fun text(ctx: Context, name: String): String? = runCatching { AtomicFile(File(ctx.filesDir, name)).read() }.getOrNull()
}
