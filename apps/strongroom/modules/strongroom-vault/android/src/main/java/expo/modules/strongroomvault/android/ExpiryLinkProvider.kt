package expo.modules.strongroomvault.android

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import expo.modules.strongroomvault.applink.AppLinkCaller
import expo.modules.strongroomvault.core.ExpiryIndex
import java.time.LocalDate

// The expiry share (apps/strongroom/src/expiry-share.ts): card expiry dates only, from ExpiryShare's index, never the vault.
// Selection, projection and sort from the caller are ignored.
class ExpiryLinkProvider : ContentProvider() {
  override fun onCreate() = true

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
    val ctx = context
    if (ctx == null || !AppLinkCaller.allowed(ctx)) throw SecurityException("Not a signed sibling app")
    if (uri.pathSegments != listOf(PATH)) throw IllegalArgumentException("Unknown path")
    val today = LocalDate.now()
    return MatrixCursor(ROW_COLUMNS).apply {
      ExpiryShare.read(ctx).take(LIST_LIMIT).forEach { addRow(ExpiryIndex.row(it, today)) }
    }
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException("Read-only")

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")

  override fun getType(uri: Uri): String? = null

  internal companion object {
    internal const val AUTHORITY = "com.haroon.strongroom.applink"
    internal const val PATH = "expiry"
    internal val ROW_COLUMNS = arrayOf("kind", "label", "expires_on", "days_left")
    internal const val LIST_LIMIT = 200
  }
}
