package expo.modules.nexuslinks.android

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import expo.modules.nexuslinks.applink.AppLinkCaller
import expo.modules.nexuslinks.core.ProvidedRows
import java.io.File
import java.time.ZoneId

/**
 * Nexus's read-only shares for its signed sibling apps: `health` and `today`. The caller check comes first, on the binder thread,
 * for every path including an unknown one. The columns are fixed, so projection, selection and sort are ignored. A query only reads
 * files/ai_source, files/last_seen and files/today.json; it never writes.
 */
class NexusLinkProvider : ContentProvider() {
  override fun onCreate() = true

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
    val c = context ?: throw SecurityException("Not a signed sibling app")
    if (!AppLinkCaller.allowed(c)) throw SecurityException("Not a signed sibling app")
    if (uri.authority != ProvidedRows.AUTHORITY) throw IllegalArgumentException("Unknown share")
    val files = c.filesDir
    return when (uri.pathSegments) {
      listOf("health") -> MatrixCursor(ProvidedRows.HEALTH_COLUMNS).apply {
        addRow(ProvidedRows.health(ProvidedRows.readSmall(File(files, "ai_source"), ProvidedRows.SMALL_FILE_MAX_BYTES), ProvidedRows.readSmall(File(files, "last_seen"), ProvidedRows.SMALL_FILE_MAX_BYTES)))
      }
      listOf("today") -> MatrixCursor(ProvidedRows.TODAY_COLUMNS).apply {
        val text = ProvidedRows.readSmall(File(files, "today.json"), ProvidedRows.TODAY_FILE_MAX_BYTES)
        ProvidedRows.today(text, System.currentTimeMillis(), ZoneId.systemDefault()).forEach { addRow(arrayOf<Any?>(it.id, it.title, it.dueAt)) }
      }
      else -> throw IllegalArgumentException("Unknown share")
    }
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException("Read-only")
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun getType(uri: Uri): String? = null
}
