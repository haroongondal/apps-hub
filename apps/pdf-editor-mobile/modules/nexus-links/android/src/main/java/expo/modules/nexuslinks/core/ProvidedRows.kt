package expo.modules.nexuslinks.core

import java.io.File
import java.time.Instant
import java.time.ZoneId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

data class TodayRow(val id: Long, val title: String, val dueAt: Long)

/**
 * What Nexus serves its signed sibling apps (src/provided.ts is the TypeScript twin; the fixtures bind the two). Pure: no android.*.
 * Both shares come from small files in files/ that the JS side writes; a query only reads them and never creates or updates one.
 *
 * files/today.json (written by the Nexus app, at most 64 KB):
 *   {"v":1,"on":true,"items":[{"title":"Call the bank","dueAt":1732400000000}, ...]}
 * `v` is 1, `on` is the owner's switch (anything but true serves nothing), `items` are the owner's own dated items, `dueAt` is epoch ms.
 * Served: items whose dueAt is inside TODAY in the device's time zone, worked out at query time (local midnight inclusive to the next
 * local midnight exclusive), in file order, id = position 1.. among the served rows, at most 100. Dropped: an empty or over 200 char
 * title, a control character in the title, a dueAt that is not a whole number or is negative. A missing, garbled or oversized file,
 * another `v`, or `on` not true serves nothing.
 *
 * files/ai_source: "hub", "own" or "none" (anything else, or no file, reads as none). files/last_seen: decimal epoch ms of the app's heartbeat.
 */
object ProvidedRows {
  const val AUTHORITY = "com.haroon.pdfeditor.applink"
  const val APP_ID = "pdf-editor"

  val HEALTH_COLUMNS = arrayOf("app_id", "accessibility", "listener", "ai_source", "last_seen_at")
  const val HEALTH_MAX_ROWS = 1
  val TODAY_COLUMNS = arrayOf("id", "title", "due_at")
  const val TODAY_MAX_ROWS = 100

  const val TODAY_FILE_MAX_BYTES = 65536
  const val SMALL_FILE_MAX_BYTES = 32
  const val MAX_TITLE_CHARS = 200
  private const val MAX_SAFE_LONG = 9007199254740991L
  private val AI_SOURCES = setOf("hub", "own", "none")
  private val DIGITS = Regex("[0-9]{1,16}")

  /** The file's text, or null when it is missing, unreadable or longer than `maxBytes`. Read only. */
  fun readSmall(file: File, maxBytes: Int): String? = runCatching {
    if (!file.isFile || file.length() > maxBytes) null else file.readBytes().takeIf { it.size <= maxBytes }?.toString(Charsets.UTF_8)
  }.getOrNull()

  fun health(aiSourceText: String?, lastSeenText: String?): Array<Any?> {
    val source = aiSourceText?.trim()?.takeIf { it in AI_SOURCES } ?: "none"
    val seen = lastSeenText?.trim()?.takeIf { DIGITS.matches(it) }?.toLongOrNull()?.takeIf { it <= MAX_SAFE_LONG }
    return arrayOf(APP_ID, null, null, source, seen)
  }

  fun today(text: String?, nowMs: Long, zone: ZoneId): List<TodayRow> = runCatching {
    if (text == null || text.length > TODAY_FILE_MAX_BYTES || text.toByteArray(Charsets.UTF_8).size > TODAY_FILE_MAX_BYTES) return emptyList()
    val root = Json.parseToJsonElement(text) as? JsonObject ?: return emptyList()
    if (whole(root["v"]) != 1L || (root["on"] as? JsonPrimitive)?.let { !it.isString && it.content == "true" } != true) return emptyList()
    val items = root["items"] as? JsonArray ?: return emptyList()
    val day = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
    val from = day.atStartOfDay(zone).toInstant().toEpochMilli()
    val to = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
    val out = ArrayList<TodayRow>()
    for (item in items) {
      if (out.size >= TODAY_MAX_ROWS) break
      val o = item as? JsonObject ?: continue
      val title = (o["title"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: continue
      val dueAt = whole(o["dueAt"]) ?: continue
      if (title.isBlank() || title.length > MAX_TITLE_CHARS || title.any { Character.isISOControl(it) }) continue
      if (dueAt < from || dueAt >= to) continue
      out.add(TodayRow((out.size + 1).toLong(), title, dueAt))
    }
    out
  }.getOrDefault(emptyList())

  /** A JSON number written as a whole number in 0..2^53-1 (not a string, not 1.0 or 1e3), else null. */
  private fun whole(e: Any?): Long? =
    (e as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull?.takeIf { it in 0..MAX_SAFE_LONG }
}
