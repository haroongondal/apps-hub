package expo.modules.inflowcore.android

import android.content.ContentProvider
import android.content.ContentValues
import android.content.UriMatcher
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Binder
import androidx.core.app.NotificationManagerCompat
import expo.modules.inflowcore.applink.AppLinkCaller
import expo.modules.inflowcore.core.AppHealth
import expo.modules.inflowcore.core.AutopilotAccess
import expo.modules.inflowcore.core.Briefing
import expo.modules.inflowcore.core.BriefingShare
import expo.modules.inflowcore.core.BriefingSnapshot
import expo.modules.inflowcore.core.NexusShares
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
 *  - `items/#` (query one source item, Deputy alone; empty for any other caller or when Inflow refuses to share it: see AutopilotAccess).
 *  - `health` (query, one row for the Store: listener on or off, where the AI keys come from, the last heartbeat; no personal data, so no switch guards it, but the caller check still does).
 *  - `briefing` (query, up to 20 lines of today's briefing, built in Inflow from structured data: see Briefing): rows only for Halo and only while 'Show my morning briefing in Halo' is on, otherwise an empty cursor. They come from the snapshot
 *    BriefingRefresh keeps; the query never runs a reader, and starts at most one background rebuild when the snapshot is older than 10 minutes. The lines that come from the health-in-briefing switch are dropped while that switch is off.
 *  - `ask_items/<sinceId>`, `ask_ids/<sinceId>`, `debits/<sinceId>` (query, Nexus alone, each behind its own switch: see NexusShares); anything else gets an empty cursor.
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
        // Read on the binder thread, so the uid is the reader's own; message text is for Deputy alone, any failure serves nothing.
        val deputy = runCatching { AutopilotAccess.callerIsDeputy(context?.packageManager?.getPackagesForUid(Binder.getCallingUid())) }.getOrDefault(false)
        val item = if (deputy && store != null) runCatching { store.autopilotItem(uri.lastPathSegment!!.toLong(), System.currentTimeMillis()) }.getOrNull() else null
        if (item != null) c.addRow(arrayOf<Any?>(item.id, item.app, item.pkg, item.sender, item.conversation, item.text, item.at))
      }
      HEALTH -> MatrixCursor(AppHealth.COLUMNS).also { c ->
        val listener = runCatching { context?.let { NotificationManagerCompat.getEnabledListenerPackages(it).contains(it.packageName) } }.getOrNull() == true
        val keys = store != null && runCatching { AiConfig(store).on() }.getOrDefault(false)
        val seen = if (store != null) runCatching { AppHealth.lastSeen(store) }.getOrNull() else null
        val source = if (store != null) runCatching { store.meta(AppHealth.META_AI_SOURCE) }.getOrNull() else null
        c.addRow(AppHealth.row(listener, keys, seen, source))
      }
      BRIEFING -> MatrixCursor(BRIEFING_COLUMNS).also { c ->
        val ctx = context
        // Read on the binder thread, before any hop, so the uid is the reader's own; any failure serves nothing.
        val halo = runCatching { BriefingShare.callerIsHalo(ctx?.packageManager?.getPackagesForUid(Binder.getCallingUid())) }.getOrDefault(false)
        if (halo && store != null && ctx != null) runCatching {
          val shareOn = Briefing.on(store.meta(Briefing.SHARE_META))
          val snapshot = BriefingSnapshot.parse(store.meta(BriefingSnapshot.META))
          BriefingShare.serve(shareOn, Briefing.on(store.meta(Briefing.HEALTH_META)), snapshot).forEach { c.addRow(it) }
          if (shareOn) BriefingRefresh.of(ctx).maybeRefresh(snapshot)
        }
      }
      ASK_ITEMS -> MatrixCursor(NexusShares.ASK_ITEMS_COLUMNS).also { c ->
        val since = nexusSince(uri, store, NexusShares.ASK_META)
        if (since != null) runCatching { store!!.nexusAskItems(since, NexusShares.PAGE).mapNotNull(NexusShares::askRow) }.getOrDefault(emptyList()).forEach { c.addRow(it) }
      }
      ASK_IDS -> MatrixCursor(NexusShares.ASK_IDS_COLUMNS).also { c ->
        val since = nexusSince(uri, store, NexusShares.ASK_META)
        if (since != null) runCatching { store!!.nexusAskIds(since, NexusShares.PAGE).mapNotNull(NexusShares::idRow) }.getOrDefault(emptyList()).forEach { c.addRow(it) }
      }
      DEBITS -> MatrixCursor(NexusShares.DEBITS_COLUMNS).also { c ->
        val since = nexusSince(uri, store, NexusShares.DEBITS_META)
        val now = System.currentTimeMillis()
        if (since != null) runCatching { SqlLedgerStore(store!!.db).nexusDebits(since, NexusShares.debitsFrom(now), NexusShares.PAGE).mapNotNull { NexusShares.debitRow(it, now) } }
          .getOrDefault(emptyList()).forEach { c.addRow(it) }
      }
      else -> throw IllegalArgumentException("Unknown uri")
    }
  }

  // Runs on the binder thread before any hop, so the calling uid is the reader's own; any failure serves nothing.
  private fun nexusSince(uri: Uri, store: SqlItemStore?, switchMeta: String): Long? = runCatching {
    NexusShares.since(context?.packageManager?.getPackagesForUid(Binder.getCallingUid()), store?.meta(switchMeta), uri.lastPathSegment)
  }.getOrNull()

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
    HEALTH -> "vnd.android.cursor.item/vnd.com.haroon.inflow.health"
    BRIEFING -> "vnd.android.cursor.dir/vnd.com.haroon.inflow.briefing"
    ASK_ITEMS -> "vnd.android.cursor.dir/vnd.com.haroon.inflow.ask_item"
    ASK_IDS -> "vnd.android.cursor.dir/vnd.com.haroon.inflow.ask_id"
    DEBITS -> "vnd.android.cursor.dir/vnd.com.haroon.inflow.debit"
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

  // internal so AutopilotProviderShareTest can bind the columns, authority and row cap to the share's fixture.
  internal companion object {
    const val AUTHORITY = "com.haroon.inflow.autopilot"
    const val LIST = 1
    const val ONE = 2
    const val ITEM = 3
    const val HEALTH = 4
    const val HEALTH_MAX_ROWS = 1
    const val BRIEFING = 5
    const val BRIEFING_MAX_ROWS = BriefingShare.MAX_ROWS
    const val ASK_ITEMS = 6
    const val ASK_IDS = 7
    const val DEBITS = 8
    const val LIST_LIMIT = 200
    // Equal to ROW_KEYS in packages/autopilot-contract/src/index.ts.
    val ROW_COLUMNS = arrayOf("id", "kind", "title", "item_id", "due_at", "state", "created_at", "expires_at")
    // Equal to appHealthShare('inflow') (packages/autopilot-contract/src/inflow-shares.ts).
    val HEALTH_COLUMNS = AppHealth.COLUMNS
    // Equal to INFLOW_BRIEFING_SHARE (packages/autopilot-contract/src/inflow-shares.ts).
    val BRIEFING_COLUMNS = BriefingShare.COLUMNS
    val ITEM_COLUMNS = arrayOf("id", "app", "pkg", "sender", "conversation", "text", "at")
    // lazy: android.jar's UriMatcher is a stub that throws on the JVM, and the share test reads the constants above.
    val matcher by lazy {
      UriMatcher(UriMatcher.NO_MATCH).apply {
        addURI(AUTHORITY, "suggestions", LIST)
        addURI(AUTHORITY, "suggestions/#", ONE)
        addURI(AUTHORITY, "items/#", ITEM)
        addURI(AUTHORITY, "health", HEALTH)
        addURI(AUTHORITY, BriefingShare.PATH, BRIEFING)
        // `*`, not `#`: a non-numeric or negative since-id must reach NexusShares.since and get an empty cursor.
        addURI(AUTHORITY, "${NexusShares.ASK_ITEMS_PATH}/*", ASK_ITEMS)
        addURI(AUTHORITY, "${NexusShares.ASK_IDS_PATH}/*", ASK_IDS)
        addURI(AUTHORITY, "${NexusShares.DEBITS_PATH}/*", DEBITS)
      }
    }
  }
}
