package expo.modules.designmedia.core

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

interface TextFile {
  fun read(): String?
  fun write(text: String)
}

class AtomicFile(private val file: File) : TextFile {
  override fun read(): String? = if (file.exists()) file.readText() else null

  override fun write(text: String) {
    val tmp = File(file.parentFile, file.name + ".tmp")
    tmp.writeText(text)
    Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
  }
}

class QueueStore(private val file: TextFile) {
  fun load(): List<Job> = file.read()?.let(::decodeJobs) ?: emptyList()

  fun save(jobs: List<Job>) = file.write(encodeJobs(jobs))
}

// shortcut: keeps the last five attempt-1 ratios per "<encoder>/<mode>", the window SPEC §6.3 names.
class EncoderStatsStore(private val file: TextFile) {
  fun all(): Map<String, List<Double>> {
    val text = file.read() ?: return emptyMap()
    return Json.parseToJsonElement(text).jsonObject.mapValues { (_, v) -> v.jsonArray.map { it.jsonPrimitive.double } }
  }

  fun record(key: String, ratio: Double) {
    val stats = all().toMutableMap()
    stats[key] = (stats[key].orEmpty() + ratio).takeLast(EncoderStatsMath.KEEP)
    file.write(JsonObject(stats.mapValues { (_, v) -> JsonArray(v.map { JsonPrimitive(it) }) }).toString())
  }
}

object EncoderStatsMath {
  const val KEEP = 5

  // Median of the last five ratios, clamped to 0.8–1.5; 1.0 when there is no history.
  fun correction(ratios: List<Double>): Double {
    if (ratios.isEmpty()) return 1.0
    val last = ratios.takeLast(KEEP).sorted()
    val mid = last.size / 2
    val median = if (last.size % 2 == 1) last[mid] else (last[mid - 1] + last[mid]) / 2
    return median.coerceIn(0.8, 1.5)
  }
}
