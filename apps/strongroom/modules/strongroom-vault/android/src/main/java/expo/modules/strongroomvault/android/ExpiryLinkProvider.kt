package expo.modules.strongroomvault.android

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import expo.modules.strongroomvault.applink.AppLinkCaller
import expo.modules.strongroomvault.core.ExpiryIndex
import expo.modules.strongroomvault.core.ExpiryItem
import java.time.LocalDate

// The expiry share (apps/strongroom/src/expiry-share.ts): card expiry dates only, from ExpiryShare's index, never the vault.
// Also serves the `health` row (AppHealth), which does not depend on the expiry switch. Selection, projection and sort from the caller are ignored.
class ExpiryLinkProvider : ContentProvider() {
  override fun onCreate() = true

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
    val ctx = context
    if (ctx == null || !AppLinkCaller.allowed(ctx)) throw SecurityException("Not a signed sibling app")
    val answer = answer(uri.pathSegments, { AppHealth.lastSeen(ctx) }, { ExpiryShare.read(ctx) }, LocalDate.now())
    return MatrixCursor(answer.columns).apply { answer.rows.forEach { addRow(it) } }
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException("Read-only")

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")

  override fun getType(uri: Uri): String? = null

  internal class Answer(val columns: Array<String>, val rows: List<List<Any?>>)

  internal companion object {
    internal fun answer(segments: List<String>, lastSeen: () -> Long?, expiry: () -> List<ExpiryItem>, today: LocalDate): Answer = when (segments) {
      listOf(PATH) -> Answer(ROW_COLUMNS, expiry().take(LIST_LIMIT).map { ExpiryIndex.row(it, today).toList() })
      listOf(AppHealth.PATH) -> Answer(AppHealth.COLUMNS, listOf(AppHealth.row(lastSeen()).toList()))
      else -> throw IllegalArgumentException("Unknown path")
    }

    internal const val AUTHORITY = "com.haroon.strongroom.applink"
    internal const val PATH = "expiry"
    internal val ROW_COLUMNS = arrayOf("kind", "label", "expires_on", "days_left")
    internal const val LIST_LIMIT = 200
  }
}
