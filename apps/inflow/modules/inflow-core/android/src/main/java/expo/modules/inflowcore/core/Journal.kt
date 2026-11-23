package expo.modules.inflowcore.core

data class JournalEntry(val id: Long, val at: Long, val mood: Int, val tags: List<String>, val note: String)

interface JournalStore {
  fun page(beforeAt: Long, limit: Int): List<JournalEntry>

  fun insert(e: JournalEntry, now: Long): Long

  fun update(e: JournalEntry): Boolean

  fun delete(id: Long)
}

fun JournalEntry.toMap(): Map<String, Any?> = mapOf("id" to id, "at" to at, "mood" to mood, "tags" to tags, "note" to note)

object Journal {
  val TAGS = listOf("headache", "tired", "stomach ache", "cough", "pain", "anxious", "low mood", "poor sleep", "dizzy", "nausea")
  const val MAX_NOTE = 2000
  const val MAX_PAGE = 200
  const val FUTURE_SLACK_MS = 60_000L
  const val GONE = "That entry was deleted."

  fun fromMap(map: Map<String, Any?>, now: Long): Result<JournalEntry> {
    val at = (map["at"] as? Number)?.toLong()
    val mood = (map["mood"] as? Number)?.toDouble()
    val rawTags = (map["tags"] as? List<*>).orEmpty()
    val tags = rawTags.filterIsInstance<String>()
    val note = (map["note"] as? String)?.trim().orEmpty()
    val problem = when {
      at == null || at <= 0 -> "Pick when this happened."
      at > now + FUTURE_SLACK_MS -> "Pick a time that isn't in the future."
      mood == null || mood % 1.0 != 0.0 || mood !in 1.0..5.0 -> "Pick a mood from 1 to 5."
      tags.size != rawTags.size || tags.any { it !in TAGS } -> "Pick tags from the list."
      note.codePointCount(0, note.length) > MAX_NOTE -> "Keep the note to $MAX_NOTE characters or fewer."
      else -> null
    }
    if (problem != null) return Result.failure(IllegalArgumentException(problem))
    val id = (map["id"] as? Number)?.toLong()?.takeIf { it > 0 } ?: 0L
    return Result.success(JournalEntry(id, at!!, mood!!.toInt(), TAGS.filter { it in tags }, note))
  }

  fun save(store: JournalStore, map: Map<String, Any?>, now: Long): String? {
    val e = fromMap(map, now).getOrElse { return it.message }
    if (e.id == 0L) store.insert(e, now)
    else if (!store.update(e)) return GONE
    return null
  }

  fun list(store: JournalStore, beforeAt: Long?, limit: Int): List<JournalEntry> = store.page(beforeAt ?: Long.MAX_VALUE, limit.coerceIn(0, MAX_PAGE))
}
