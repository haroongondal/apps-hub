package expo.modules.inflowcore.android

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Binder
import android.os.Looper
import android.os.Process
import expo.modules.inflowcore.applink.AppLinkTarget
import expo.modules.inflowcore.core.AppLine
import expo.modules.inflowcore.core.Briefing
import expo.modules.inflowcore.core.BriefingHealth
import expo.modules.inflowcore.core.BriefingInputs
import expo.modules.inflowcore.core.BriefingReaders
import expo.modules.inflowcore.core.DueThing
import expo.modules.inflowcore.core.LinkResolver
import expo.modules.inflowcore.core.LinkTable
import expo.modules.inflowcore.core.StoreBriefingHealth
import expo.modules.inflowcore.core.SuggestionKind
import expo.modules.inflowcore.core.Txn
import java.time.LocalDate
import java.time.ZoneId

class StoreBriefingInputs(private val store: SqlItemStore, private val context: Context, private val zone: ZoneId) : BriefingInputs {
  override val healthOn: Boolean get() = Briefing.on(store.meta(Briefing.HEALTH_META))

  override fun due(): List<DueThing> =
    SqlSuggestionStore(store.db).waiting().mapNotNull { s -> s.dueAt?.takeIf { s.kind == SuggestionKind.BILL || s.kind == SuggestionKind.EVENT }?.let { DueThing(s.id, s.kind, it) } }

  override fun txns(from: Long, to: Long): List<Txn> = SqlReportStore(store.db).txns(from, to)

  override fun health(): BriefingHealth = StoreBriefingHealth(SqlHealthStore(store.db), SqlMedicineStore(store))

  // Never on the main thread, and never while serving another app's call into Inflow's own provider (that binder thread must answer fast).
  override fun others(): List<AppLine> =
    if (Looper.myLooper() == Looper.getMainLooper() || Binder.getCallingUid() != Process.myUid()) emptyList()
    else BriefingReaders.lines(
      AndroidLinkResolver(context.contentResolver),
      { authority, pkg -> AppLinkTarget.trustedProvider(context, authority, pkg) },
      LocalDate.now(zone),
    )
}

class AndroidLinkResolver(private val resolver: ContentResolver) : LinkResolver {
  override fun query(uri: String): LinkTable? =
    resolver.query(Uri.parse(uri), null, null, null, null)?.use { c ->
      val rows = ArrayList<List<Any?>>()
      while (rows.size < BriefingReaders.MAX_ROWS && c.moveToNext()) {
        rows += (0 until c.columnCount).map { i ->
          when (c.getType(i)) {
            Cursor.FIELD_TYPE_INTEGER -> c.getLong(i)
            Cursor.FIELD_TYPE_STRING -> c.getString(i)
            Cursor.FIELD_TYPE_NULL -> null
            Cursor.FIELD_TYPE_FLOAT -> c.getDouble(i)
            else -> c.getBlob(i)
          }
        }
      }
      LinkTable(c.columnNames.toList(), rows)
    }
}
