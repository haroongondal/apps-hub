package expo.modules.inflowcore.android

import android.database.Cursor
import expo.modules.inflowcore.core.Period
import expo.modules.inflowcore.core.ReportKind
import expo.modules.inflowcore.core.ReportRow
import expo.modules.inflowcore.core.ReportStore
import expo.modules.inflowcore.core.Txn
import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SQLiteStatement

/** The reports table (schema v6) in the item store's database. */
class SqlReportStore(private val db: SQLiteDatabase) : ReportStore {
  override fun row(p: Period): ReportRow? =
    rows("kind = ? AND period_start = ? AND partial = ?", p.kind.name, p.start, flag(p.partial)).firstOrNull()

  override fun save(p: Period, status: String, message: String?, tries: Int, headline: String?, json: String?, now: Long): Long {
    run(
      "INSERT INTO reports(kind, period_start, period_end, partial, created_at, status, message, tries, headline, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(kind, period_start, partial) DO UPDATE SET period_end = excluded.period_end, created_at = excluded.created_at, status = excluded.status, " +
        "message = excluded.message, tries = excluded.tries, headline = excluded.headline, json = excluded.json",
      p.kind.name, p.start, p.end, flag(p.partial), now, status, message, tries.toLong(), headline, json,
    )
    return row(p)!!.id
  }

  override fun previousJson(kind: ReportKind, before: Long): String? =
    db.rawQuery(
      "SELECT json FROM reports WHERE kind = ? AND partial = 0 AND status = 'ready' AND json IS NOT NULL AND period_start < ? ORDER BY period_start DESC LIMIT 1",
      kind.name, before,
    ).use { if (it.moveToFirst()) it.getString(0) else null }

  override fun txns(from: Long, to: Long): List<Txn> = SqlLedgerStore(db).between(from, to)

  override fun prune() {
    for ((kind, keep) in listOf(ReportKind.WEEKLY to 8L, ReportKind.MONTHLY to 4L)) {
      run(
        "DELETE FROM reports WHERE kind = ? AND partial = 0 AND id NOT IN " +
          "(SELECT id FROM reports WHERE kind = ? AND partial = 0 ORDER BY period_start DESC LIMIT ?)",
        kind.name, kind.name, keep,
      )
    }
  }

  override fun deletePartial(kind: ReportKind) {
    run("DELETE FROM reports WHERE kind = ? AND partial = 1", kind.name)
  }

  fun get(id: Long): ReportRow? = rows("id = ?", id).firstOrNull()

  /** Newest period first (a week so far sorts above the week before it). */
  fun list(): List<ReportRow> = rows("1 = 1")

  /** The stored JSON as a Map/List tree for JS; null when the row has no JSON. */
  fun data(id: Long): Any? =
    db.rawQuery("SELECT json FROM reports WHERE id = ?", id).use { c ->
      if (c.moveToFirst() && !c.isNull(0)) tree(Json.parseToJsonElement(c.getString(0))) else null
    }

  private fun rows(where: String, vararg args: Any?): List<ReportRow> =
    db.rawQuery(
      "SELECT id, kind, period_start, period_end, partial, created_at, status, message, tries, headline FROM reports WHERE $where ORDER BY period_start DESC, partial DESC, id DESC",
      *args,
    ).use { c -> buildList { while (c.moveToNext()) add(c.toRow()) } }

  private fun Cursor.toRow() = ReportRow(
    getLong(0), ReportKind.valueOf(getString(1)), getLong(2), getLong(3), getInt(4) != 0, getLong(5), getString(6),
    if (isNull(7)) null else getString(7), getInt(8), if (isNull(9)) null else getString(9),
  )

  private fun flag(b: Boolean) = if (b) 1L else 0L

  private fun run(sql: String, vararg args: Any?) {
    db.compileStatement(sql).use { st ->
      args.forEachIndexed { i, a -> st.bind(i + 1, a) }
      st.executeUpdateDelete()
    }
  }

  private fun SQLiteStatement.bind(i: Int, a: Any?) {
    when (a) {
      null -> bindNull(i)
      is Long -> bindLong(i, a)
      else -> bindString(i, a.toString())
    }
  }

  companion object {
    /** JSON objects become Maps, arrays Lists, whole numbers Longs, other numbers Doubles. */
    fun tree(e: JsonElement): Any? = when (e) {
      is JsonNull -> null
      is JsonObject -> LinkedHashMap<String, Any?>().also { m -> e.forEach { (k, v) -> m[k] = tree(v) } }
      is JsonArray -> e.map(::tree)
      is JsonPrimitive -> when {
        e.isString -> e.content
        e.booleanOrNull != null -> e.booleanOrNull
        e.content.any { it == '.' || it == 'e' || it == 'E' } -> e.content.toDouble()
        else -> e.content.toLong()
      }
    }

    fun row(r: ReportRow): Map<String, Any?> = mapOf(
      "id" to r.id, "kind" to r.kind.name.lowercase(Locale.ROOT), "periodStart" to r.periodStart, "periodEnd" to r.periodEnd,
      "partial" to r.partial, "createdAt" to r.createdAt, "status" to r.status, "message" to r.message, "headline" to r.headline,
    )
  }
}
