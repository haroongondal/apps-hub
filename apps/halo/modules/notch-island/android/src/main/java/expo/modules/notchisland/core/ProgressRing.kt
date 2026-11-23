package expo.modules.notchisland.core

// Privacy: the ring keeps a notification's key, app and progress numbers only, never its text or other extras.
data class RingNote(val key: String, val pkg: String, val progress: Int, val max: Int, val indeterminate: Boolean, val postedAt: Long)

data class RingShown(val key: String, val pkg: String, val fraction: Float?)

class ProgressRing(private val ownPkg: String, private val holdMs: Long = HOLD_MS) {
  private class Entry(val note: RingNote, val doneAt: Long?, val gone: Boolean)

  private val entries = mutableMapOf<String, Entry>()

  fun qualifies(note: RingNote, ongoing: Boolean, secret: Boolean): Boolean =
    ongoing && !secret && note.pkg != ownPkg && (note.indeterminate || note.max > 0)

  fun posted(note: RingNote, ongoing: Boolean, secret: Boolean, now: Long) {
    if (!qualifies(note, ongoing, secret)) return removed(note.key, now)
    val doneAt = if (fraction(note) == 1f) entries[note.key]?.doneAt ?: now else null
    entries[note.key] = Entry(note, doneAt, gone = false)
  }

  // A ring at 100% holds for holdMs from when it got there, even once its notification is gone; any other ring drops at once.
  fun removed(key: String, now: Long) {
    val e = entries[key] ?: return
    if (e.doneAt != null && now < e.doneAt + holdMs) entries[key] = Entry(e.note, e.doneAt, gone = true) else entries.remove(key)
  }

  fun shown(now: Long): RingShown? {
    entries.values.removeAll { it.gone && !live(it, now) }
    return entries.values.filter { live(it, now) }
      .maxWithOrNull(compareBy<Entry>({ it.note.postedAt }, { it.note.key }))
      ?.let { RingShown(it.note.key, it.note.pkg, fraction(it.note)) }
  }

  fun nextExpiry(now: Long): Long? = entries.values.mapNotNull { it.doneAt?.plus(holdMs) }.filter { it > now }.minOrNull()

  fun clear() = entries.clear()

  private fun live(e: Entry, now: Long) = e.doneAt == null || now < e.doneAt + holdMs

  companion object {
    const val HOLD_MS = 2_500L
    const val SPIN_FRAME_MS = 66L

    fun fraction(note: RingNote): Float? =
      if (note.indeterminate || note.max <= 0) null else (note.progress.toDouble() / note.max).coerceIn(0.0, 1.0).toFloat()
  }
}
