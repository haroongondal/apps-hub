package expo.modules.designmedia.core

import java.io.File
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

private fun parse(text: String): JsonArray? = try { Json.parseToJsonElement(text) as? JsonArray } catch (_: Exception) { null }

// Parses a JSON array of objects with `row`; a row that does not fit is skipped, a file that does not parse is empty.
private fun <T> readRows(file: File, row: (JsonObject) -> T): List<T> {
  if (!file.exists()) return emptyList()
  val array = parse(file.readText()) ?: return emptyList()
  return array.mapNotNull { try { row(it.jsonObject) } catch (_: Exception) { null } }
}

// A file that no longer parses is kept as <name>.bad (the latest only) so its entries can be recovered by hand.
private fun writeRows(file: File, rows: JsonArray) {
  if (file.exists() && parse(file.readText()) == null) file.renameTo(File(file.parentFile, file.name + ".bad"))
  AtomicFile(file).write(rows.toString())
}

class TrashRecord(private val file: File) {
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

  private fun save(entries: List<TrashEntry>) = writeRows(file, JsonArray(entries.map {
    JsonObject(mapOf("uri" to JsonPrimitive(it.uri), "name" to JsonPrimitive(it.name),
      "bytes" to JsonPrimitive(it.bytes), "trashedAt" to JsonPrimitive(it.trashedAt)))
  }))
}

// "Not a mistake": (kind wire string, MediaStore id) pairs that never show in that kind again.
class Dismissals(private val file: File) {
  @Synchronized fun all(): Set<Pair<String, Long>> =
    readRows(file) { it.getValue("kind").jsonPrimitive.content to it.getValue("id").jsonPrimitive.long }.toSet()

  @Synchronized fun add(kind: String, ids: Collection<Long>) = save(all() + ids.map { kind to it })

  @Synchronized fun clear() = save(emptySet())

  private fun save(pairs: Set<Pair<String, Long>>) = writeRows(file, JsonArray(pairs.map { (kind, id) ->
    JsonObject(mapOf("kind" to JsonPrimitive(kind), "id" to JsonPrimitive(id)))
  }))
}

// One instance per file for the process: the @Synchronized methods only guard callers that share the object.
object CleanupStores {
  private val records = HashMap<String, TrashRecord>()
  private val dismissals = HashMap<String, Dismissals>()

  @Synchronized fun record(file: File): TrashRecord = records.getOrPut(file.absolutePath) { TrashRecord(file) }

  @Synchronized fun dismissals(file: File): Dismissals = dismissals.getOrPut(file.absolutePath) { Dismissals(file) }
}

// MediaStore may only drop entries with full photo access: revoked or Selected-photos access gives an empty cursor, and a
// failed query gives none; either way dropping would hide photos the owner can still restore.
fun recentEntries(record: TrashRecord, now: Long, fullAccess: Boolean, stillTrashed: Set<String>?): List<TrashEntry> =
  if (fullAccess && stillTrashed != null) record.recent(now, stillTrashed)
  else record.all().filter { now - it.trashedAt <= TRASH_KEEP_MS }
