package expo.modules.designmedia.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

// Photos Clean up sent to Android's trash, kept so "Recently removed" can bring them back. Plain DOM JSON like Plans.kt
// (no serialization plugin). A missing or unreadable file reads as empty; every write goes through AtomicFile.
data class TrashEntry(val uri: String, val name: String, val bytes: Long, val trashedAt: Long)

const val TRASH_KEEP_MS = 30L * 24 * 60 * 60 * 1000

// Parses a JSON array of objects with `row`; a row that does not fit is skipped, a file that does not parse is empty.
private fun <T> readRows(file: AtomicFile, row: (JsonObject) -> T): List<T> {
  val text = file.read() ?: return emptyList()
  val array = try { Json.parseToJsonElement(text) as? JsonArray } catch (_: Exception) { null } ?: return emptyList()
  return array.mapNotNull { try { row(it.jsonObject) } catch (_: Exception) { null } }
}

class TrashRecord(private val file: AtomicFile) {
  @Synchronized fun all(): List<TrashEntry> = readRows(file) {
    TrashEntry(it.getValue("uri").jsonPrimitive.content, it.getValue("name").jsonPrimitive.content,
      it.getValue("bytes").jsonPrimitive.long, it.getValue("trashedAt").jsonPrimitive.long)
  }

  @Synchronized fun add(entries: List<TrashEntry>) {
    val uris = entries.map { it.uri }.toSet()
    save(all().filter { it.uri !in uris } + entries.associateBy { it.uri }.values)
  }

  @Synchronized fun remove(uris: Set<String>) = save(all().filter { it.uri !in uris })

  // Keeps entries under 30 days old that MediaStore still reports trashed; saves without the rest.
  @Synchronized fun recent(now: Long, stillTrashed: Set<String>): List<TrashEntry> {
    val before = all()
    val kept = before.filter { now - it.trashedAt <= TRASH_KEEP_MS && it.uri in stillTrashed }
    if (kept.size != before.size) save(kept)
    return kept
  }

  private fun save(entries: List<TrashEntry>) = file.write(JsonArray(entries.map {
    JsonObject(mapOf("uri" to JsonPrimitive(it.uri), "name" to JsonPrimitive(it.name),
      "bytes" to JsonPrimitive(it.bytes), "trashedAt" to JsonPrimitive(it.trashedAt)))
  }).toString())
}

// "Not a mistake": (kind wire string, MediaStore id) pairs that never show in that kind again.
class Dismissals(private val file: AtomicFile) {
  @Synchronized fun all(): Set<Pair<String, Long>> =
    readRows(file) { it.getValue("kind").jsonPrimitive.content to it.getValue("id").jsonPrimitive.long }.toSet()

  @Synchronized fun add(kind: String, ids: Collection<Long>) = save(all() + ids.map { kind to it })

  @Synchronized fun clear() = save(emptySet())

  private fun save(pairs: Set<Pair<String, Long>>) = file.write(JsonArray(pairs.map { (kind, id) ->
    JsonObject(mapOf("kind" to JsonPrimitive(kind), "id" to JsonPrimitive(id)))
  }).toString())
}
