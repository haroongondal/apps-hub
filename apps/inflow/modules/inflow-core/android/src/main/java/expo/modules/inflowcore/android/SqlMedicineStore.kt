package expo.modules.inflowcore.android

import android.database.Cursor
import expo.modules.inflowcore.core.DoseMark
import expo.modules.inflowcore.core.Medicine
import expo.modules.inflowcore.core.MedicineStore
import expo.modules.inflowcore.core.Medicines
import expo.modules.inflowcore.core.ReminderState
import java.time.LocalDate

/** The medicines and dose_log tables (schema v10). Reminder runs and marks are wrapped in SqlItemStore.inTransaction by the caller. */
class SqlMedicineStore(private val store: SqlItemStore) : MedicineStore {
  private val db = store.db

  override fun medicines(): List<Medicine> = store.query(ALL).use { c -> buildList { while (c.moveToNext()) add(c.toMedicine()) } }

  override fun get(id: Long): Medicine? = store.query(ONE, id).use { c -> if (c.moveToFirst()) c.toMedicine() else null }

  override fun insert(m: Medicine): Long {
    val args = listOf(m.name, m.dose, Medicines.timesText(m.times), Medicines.daysText(m.days), m.startDay.toString(), m.endDay?.toString(), m.createdAt)
    return db.compileStatement(INSERT).use { st ->
      args.forEachIndexed { i, a -> if (a == null) st.bindNull(i + 1) else if (a is Long) st.bindLong(i + 1, a) else st.bindString(i + 1, a.toString()) }
      st.executeInsert()
    }
  }

  override fun update(m: Medicine) {
    db.execSQL(UPDATE, arrayOf<Any?>(m.name, m.dose, Medicines.timesText(m.times), Medicines.daysText(m.days), m.startDay.toString(), m.endDay?.toString(), m.id))
  }

  override fun stop(id: Long) = db.execSQL(STOP, arrayOf<Any?>(id))

  override fun delete(id: Long) = store.inTransaction {
    db.execSQL(DELETE_LOG, arrayOf<Any?>(id))
    db.execSQL(DELETE, arrayOf<Any?>(id))
  }

  override fun log(fromMs: Long, toMs: Long): List<DoseMark> =
    store.query(LOG_RANGE, fromMs, toMs).use { c -> buildList { while (c.moveToNext()) add(DoseMark(c.getLong(0), c.getLong(1), c.getString(2), c.getLong(3))) } }

  override fun mark(m: DoseMark) = db.execSQL(MARK, arrayOf<Any?>(m.medicineId, m.dueAt, m.status, m.markedAt))

  override fun recordMissed(marks: List<DoseMark>) {
    for (m in marks) db.execSQL(MISSED, arrayOf<Any?>(m.medicineId, m.dueAt, m.markedAt))
  }

  override fun reminderState(): ReminderState? = Medicines.parseState(store.meta(STATE))

  override fun setReminderState(s: ReminderState) = store.setMeta(STATE, Medicines.stateText(s))

  private fun Cursor.toMedicine() = Medicine(
    getLong(0), getString(1), getString(2), Medicines.parseTimes(getString(3)), Medicines.parseDays(getString(4)),
    LocalDate.parse(getString(5)), if (isNull(6)) null else LocalDate.parse(getString(6)), getInt(7) != 0, getLong(8),
  )

  companion object {
    const val STATE = "medicineReminders"
    private const val COLUMNS = "id, name, dose, times, days, start_day, end_day, active, created_at"
    internal const val ALL = "SELECT $COLUMNS FROM medicines ORDER BY active DESC, name COLLATE NOCASE, id"
    internal const val ONE = "SELECT $COLUMNS FROM medicines WHERE id = ?"
    internal const val INSERT = "INSERT INTO medicines(name, dose, times, days, start_day, end_day, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)"
    internal const val UPDATE = "UPDATE medicines SET name = ?, dose = ?, times = ?, days = ?, start_day = ?, end_day = ? WHERE id = ?"
    internal const val STOP = "UPDATE medicines SET active = 0 WHERE id = ?"
    internal const val DELETE_LOG = "DELETE FROM dose_log WHERE medicine_id = ?"
    internal const val DELETE = "DELETE FROM medicines WHERE id = ?"
    internal const val LOG_RANGE = "SELECT medicine_id, due_at, status, marked_at FROM dose_log WHERE due_at >= ? AND due_at < ? ORDER BY due_at, medicine_id"
    internal const val MARK =
      "INSERT INTO dose_log(medicine_id, due_at, status, marked_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(medicine_id, due_at) DO UPDATE SET status = excluded.status, marked_at = excluded.marked_at"
    internal const val MISSED = "INSERT OR IGNORE INTO dose_log(medicine_id, due_at, status, marked_at) VALUES (?, ?, 'missed', ?)"
  }
}
