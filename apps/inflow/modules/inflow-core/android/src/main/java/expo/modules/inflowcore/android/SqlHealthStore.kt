package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.HealthDay
import expo.modules.inflowcore.core.HealthStore
import net.zetetic.database.sqlcipher.SQLiteDatabase

/** The health_daily table (schema v9). The caller wraps replaceDays in SqlItemStore.inTransaction. */
class SqlHealthStore(private val db: SQLiteDatabase) : HealthStore {
  override fun replaceDays(first: String, last: String, rows: List<HealthDay>, keepFrom: String, now: Long) {
    db.execSQL(DELETE_RANGE, arrayOf<Any?>(first, last))
    for (r in rows) db.execSQL(UPSERT, arrayOf<Any?>(r.day, r.steps, r.sleepMinutes?.toLong(), r.hrAvg?.toLong(), r.hrLow?.toLong(), now))
    db.execSQL(PRUNE, arrayOf<Any?>(keepFrom))
  }

  override fun days(from: String, to: String): List<HealthDay> =
    db.rawQuery(RANGE, from, to).use { c ->
      buildList {
        while (c.moveToNext()) {
          add(
            HealthDay(
              c.getString(0), if (c.isNull(1)) null else c.getLong(1), if (c.isNull(2)) null else c.getInt(2),
              if (c.isNull(3)) null else c.getInt(3), if (c.isNull(4)) null else c.getInt(4),
            ),
          )
        }
      }
    }

  companion object {
    internal const val DELETE_RANGE = "DELETE FROM health_daily WHERE day >= ? AND day <= ?"
    internal const val UPSERT =
      "INSERT INTO health_daily(day, steps, sleep_minutes, hr_avg, hr_low, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(day) DO UPDATE SET steps = excluded.steps, sleep_minutes = excluded.sleep_minutes, hr_avg = excluded.hr_avg, " +
        "hr_low = excluded.hr_low, updated_at = excluded.updated_at"
    internal const val PRUNE = "DELETE FROM health_daily WHERE day < ?"
    internal const val RANGE = "SELECT day, steps, sleep_minutes, hr_avg, hr_low FROM health_daily WHERE day >= ? AND day <= ? ORDER BY day"
  }
}
