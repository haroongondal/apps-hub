package expo.modules.inflowcore.core

class MemoryMedicineStore : MedicineStore {
  val meds = linkedMapOf<Long, Medicine>()
  val marks = linkedMapOf<Pair<Long, Long>, DoseMark>()
  var state: ReminderState? = null
  private var nextId = 1L

  override fun medicines() = meds.values.sortedWith(compareBy({ !it.active }, { it.name.lowercase() }, { it.id }))

  override fun get(id: Long) = meds[id]

  override fun insert(m: Medicine): Long {
    val id = nextId++
    meds[id] = m.copy(id = id, active = true)
    return id
  }

  override fun update(m: Medicine) {
    val old = meds[m.id] ?: return
    meds[m.id] = m.copy(active = old.active, createdAt = old.createdAt)
  }

  override fun stop(id: Long) {
    meds[id]?.let { meds[id] = it.copy(active = false) }
  }

  override fun delete(id: Long) {
    marks.keys.removeAll { it.first == id }
    meds.remove(id)
  }

  override fun log(fromMs: Long, toMs: Long) = marks.values.filter { it.dueAt in fromMs until toMs }.sortedWith(compareBy({ it.dueAt }, { it.medicineId }))

  override fun mark(m: DoseMark) {
    marks[m.medicineId to m.dueAt] = m
  }

  override fun recordMissed(marks: List<DoseMark>) {
    for (m in marks) this.marks.putIfAbsent(m.medicineId to m.dueAt, m)
  }

  override fun reminderState() = state

  override fun setReminderState(s: ReminderState) {
    state = s
  }
}

class MemoryJournalStore : JournalStore {
  val rows = linkedMapOf<Long, JournalEntry>()
  private var nextId = 1L

  override fun page(beforeAt: Long, limit: Int) =
    rows.values.filter { it.at < beforeAt }.sortedWith(compareByDescending<JournalEntry> { it.at }.thenByDescending { it.id }).take(limit)

  override fun insert(e: JournalEntry, now: Long): Long {
    val id = nextId++
    rows[id] = e.copy(id = id)
    return id
  }

  override fun update(e: JournalEntry): Boolean {
    if (e.id !in rows) return false
    rows[e.id] = e
    return true
  }

  override fun delete(id: Long) {
    rows.remove(id)
  }
}
