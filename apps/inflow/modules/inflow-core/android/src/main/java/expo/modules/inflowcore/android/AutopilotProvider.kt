package expo.modules.inflowcore.android

import android.content.ContentProvider
import android.content.ContentValues
import android.content.UriMatcher
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import expo.modules.inflowcore.applink.AppLinkCaller
import expo.modules.inflowcore.core.Suggestion
import expo.modules.inflowcore.core.SuggestionMoves
import expo.modules.inflowcore.core.SuggestionState

/**
 * What Deputy (and later Halo) may ask Inflow, guarded by the signature permission AUTOPILOT for read and write (see the manifest);
 * AppLinkCaller then also checks the caller's signing certificate. It reads through StoreHolder, whose key needs no unlock, so it answers while Inflow's own screens are
 * locked or the app is not running. When the store cannot be opened it answers with an empty cursor or 0.
 *
 *  - `suggestions` (query): the SuggestionRow columns of the contract, no summaries or text. `?state=waiting,started` picks states, default waiting.
 *  - `suggestions/#` (query one row, update `state` to started, done or skipped).
 *  - `items/#` (query one source item; empty when Inflow refuses to share it: see AutopilotAccess).
 *
 * The projection, selection and sort arguments are ignored: the columns are fixed.
 */
class AutopilotProvider : ContentProvider() {
  override fun onCreate() = true

  private fun store(): SqlItemStore? = context?.let { StoreHolder.get(it).getOrNull() }

  /** The manifest permission is the first gate; this also needs the caller's signing certificate to be Inflow's own (a null context is denied). */
  private fun requireSibling() {
    if (context?.let { AppLinkCaller.allowed(it) } != true) throw SecurityException("Not a signed sibling app")
  }

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor {
    requireSibling()
    val store = runCatching { store() }.getOrNull()
    return when (matcher.match(uri)) {
      LIST -> MatrixCursor(ROW_COLUMNS).also { c ->
        if (store != null) runCatching { fresh(store).list(states(uri), LIST_LIMIT) }.getOrDefault(emptyList()).forEach { c.addRow(row(it)) }
      }
      ONE -> MatrixCursor(ROW_COLUMNS).also { c ->
        if (store != null) runCatching { fresh(store).get(uri.lastPathSegment!!.toLong()) }.getOrNull()?.let { c.addRow(row(it)) }
      }
      ITEM -> MatrixCursor(ITEM_COLUMNS).also { c ->
        val item = if (store != null) runCatching { store.autopilotItem(uri.lastPathSegment!!.toLong(), System.currentTimeMillis()) }.getOrNull() else null
        if (item != null) c.addRow(arrayOf<Any?>(item.id, item.app, item.pkg, item.sender, item.conversation, item.text, item.at))
      }
      else -> throw IllegalArgumentException("Unknown uri")
    }
  }

  /** Rows changed: 0 for an unknown id, any value but started, done or skipped, an illegal move (SuggestionState.movableFrom decides) or a store that will not open. */
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int {
    requireSibling()
    if (matcher.match(uri) != ONE) return 0
    val state = when (values?.getAsString("state")) {
      "started" -> SuggestionState.STARTED
      "done" -> SuggestionState.DONE
      "skipped" -> SuggestionState.SKIPPED
      else -> return 0
    }
    val id = uri.lastPathSegment?.toLongOrNull() ?: return 0
    return runCatching { store()?.let { SuggestionMoves.move(SqlSuggestionStore(it.db), id, state, System.currentTimeMillis()) } }.getOrNull()?.let { if (it) 1 else 0 } ?: 0
  }

  override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException("Read-only")
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("Read-only")

  override fun getType(uri: Uri): String? = when (matcher.match(uri)) {
    LIST -> "vnd.android.cursor.dir/vnd.com.haroon.inflow.suggestion"
    ONE -> "vnd.android.cursor.item/vnd.com.haroon.inflow.suggestion"
    ITEM -> "vnd.android.cursor.item/vnd.com.haroon.inflow.item"
    else -> null
  }

  /** Expired rows are swept before every read, so nobody sees one as waiting. */
  private fun fresh(store: SqlItemStore) = SqlSuggestionStore(store.db).also { it.expire(System.currentTimeMillis()) }

  private fun states(uri: Uri): Set<SuggestionState> {
    val wanted = uri.getQueryParameter("state")?.split(",")?.mapNotNull { n -> SuggestionState.values().firstOrNull { it.name.equals(n.trim(), ignoreCase = true) } }?.toSet()
    return if (wanted.isNullOrEmpty()) setOf(SuggestionState.WAITING) else wanted
  }

  private fun row(s: Suggestion): Array<Any?> =
    arrayOf(s.id, s.kind.name.lowercase(), s.title, s.itemId, s.dueAt, s.state.name.lowercase(), s.createdAt, s.expiresAt)

  private companion object {
    const val AUTHORITY = "com.haroon.inflow.autopilot"
    const val LIST = 1
    const val ONE = 2
    const val ITEM = 3
    const val LIST_LIMIT = 200
    // Equal to ROW_KEYS in packages/autopilot-contract/src/index.ts.
    val ROW_COLUMNS = arrayOf("id", "kind", "title", "item_id", "due_at", "state", "created_at", "expires_at")
    val ITEM_COLUMNS = arrayOf("id", "app", "pkg", "sender", "conversation", "text", "at")
    val matcher = UriMatcher(UriMatcher.NO_MATCH).apply {
      addURI(AUTHORITY, "suggestions", LIST)
      addURI(AUTHORITY, "suggestions/#", ONE)
      addURI(AUTHORITY, "items/#", ITEM)
    }
  }
}
