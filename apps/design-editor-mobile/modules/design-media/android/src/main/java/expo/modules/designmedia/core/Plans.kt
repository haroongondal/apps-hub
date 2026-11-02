package expo.modules.designmedia.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

// Mirrors packages/media-core/src/types.ts. DOM parsing, not @Serializable: the serialization
// compiler plugin isn't on the app's Gradle classpath (Deputy avoids it too).

data class Rung(val shortSide: Int, val fps: Int)
data class SizeAudio(val mode: String, val bps: Int = 0)
data class SizePlan(
  val targetBytes: Long, val encoder: String, val rung: Rung, val width: Int, val height: Int,
  val videoBps: Int, val audio: SizeAudio, val overheadBytes: Long, val plannedVideoBytes: Long,
  val plannedBytes: Long, val attempt: Int, val margin: Double, val fpsCap: Int,
)
data class Output(val name: String, val ref: String, val bytes: Long, val note: String? = null)
data class AttemptLog(val attempt: Int, val plannedBytes: Long, val actualBytes: Long, val seconds: Double, val mode: String)

enum class JobState {
  QUEUED, RUNNING, DONE, FAILED, CANCELLED, INTERRUPTED, PAUSED;

  val wire: String get() = name.lowercase()

  companion object {
    fun of(wire: String): JobState = valueOf(wire.uppercase())
  }
}

data class Job(
  val id: String, val inputId: String, val inputName: String, val plan: SizePlan, val state: JobState,
  val progress: Double, val attempt: Int, val outputs: List<Output>, val error: String? = null,
  val startedAt: Long? = null, val finishedAt: Long? = null, val attempts: List<AttemptLog> = emptyList(),
)

fun decodeJobs(text: String): List<Job> = Json.parseToJsonElement(text).jsonArray.map { decodeJob(it.jsonObject) }

fun encodeJobs(jobs: List<Job>): String = JsonArray(jobs.map { encodeJob(it) }).toString()

fun decodeJob(o: JsonObject): Job = Job(
  id = textOf(o, "id"),
  inputId = textOf(o, "inputId"),
  inputName = textOf(o, "inputName"),
  plan = decodeSizePlan(objectOf(o, "plan")),
  state = JobState.of(textOf(o, "state")),
  progress = doubleOf(o, "progress"),
  attempt = intOf(o, "attempt"),
  outputs = o["outputs"]?.jsonArray?.map { decodeOutput(it.jsonObject) } ?: emptyList(),
  error = o["error"]?.jsonPrimitive?.content,
  startedAt = o["startedAt"]?.jsonPrimitive?.long,
  finishedAt = o["finishedAt"]?.jsonPrimitive?.long,
  attempts = o["attempts"]?.jsonArray?.map { decodeAttempt(it.jsonObject) } ?: emptyList(),
)

fun encodeJob(j: Job): JsonObject = buildJsonObject {
  put("id", j.id)
  put("inputId", j.inputId)
  put("inputName", j.inputName)
  put("plan", encodeSizePlan(j.plan))
  put("state", j.state.wire)
  put("progress", j.progress)
  put("attempt", j.attempt)
  put("outputs", JsonArray(j.outputs.map { encodeOutput(it) }))
  j.error?.let { put("error", it) }
  j.startedAt?.let { put("startedAt", it) }
  j.finishedAt?.let { put("finishedAt", it) }
  put("attempts", JsonArray(j.attempts.map { encodeAttempt(it) }))
}

fun decodeSizePlan(o: JsonObject): SizePlan {
  require(textOf(o, "tool") == "size") { "Only size jobs are supported in Phase 1." }
  val audio = objectOf(o, "audio")
  val rung = objectOf(o, "rung")
  return SizePlan(
    targetBytes = longOf(o, "targetBytes"),
    encoder = textOf(o, "encoder"),
    rung = Rung(intOf(rung, "shortSide"), intOf(rung, "fps")),
    width = intOf(o, "width"),
    height = intOf(o, "height"),
    videoBps = intOf(o, "videoBps"),
    audio = SizeAudio(textOf(audio, "mode"), audio["bps"]?.jsonPrimitive?.int ?: 0),
    overheadBytes = longOf(o, "overheadBytes"),
    plannedVideoBytes = longOf(o, "plannedVideoBytes"),
    plannedBytes = longOf(o, "plannedBytes"),
    attempt = intOf(o, "attempt"),
    margin = doubleOf(o, "margin"),
    fpsCap = intOf(o, "fpsCap"),
  )
}

fun encodeSizePlan(p: SizePlan): JsonObject = buildJsonObject {
  put("tool", "size")
  put("targetBytes", p.targetBytes)
  put("encoder", p.encoder)
  put("rung", buildJsonObject { put("shortSide", p.rung.shortSide); put("fps", p.rung.fps) })
  put("width", p.width)
  put("height", p.height)
  put("videoBps", p.videoBps)
  put("audio", buildJsonObject { put("mode", p.audio.mode); if (p.audio.mode == "aac") put("bps", p.audio.bps) })
  put("overheadBytes", p.overheadBytes)
  put("plannedVideoBytes", p.plannedVideoBytes)
  put("plannedBytes", p.plannedBytes)
  put("attempt", p.attempt)
  put("margin", p.margin)
  put("fpsCap", p.fpsCap)
}

fun Job.toStatusMap(): Map<String, Any?> = mapOf(
  "id" to id,
  "state" to state.wire,
  "progress" to progress,
  "attempt" to attempt,
  "outputs" to outputs.map { mapOf("name" to it.name, "ref" to it.ref, "bytes" to it.bytes, "note" to it.note) },
  "error" to error,
  "attempts" to attempts.map {
    mapOf("attempt" to it.attempt, "plannedBytes" to it.plannedBytes, "actualBytes" to it.actualBytes,
      "seconds" to it.seconds, "mode" to it.mode)
  },
)

private fun decodeOutput(o: JsonObject) = Output(
  name = textOf(o, "name"), ref = textOf(o, "ref"), bytes = longOf(o, "bytes"),
  note = o["note"]?.jsonPrimitive?.content,
)

private fun encodeOutput(o: Output): JsonObject = buildJsonObject {
  put("name", o.name)
  put("ref", o.ref)
  put("bytes", o.bytes)
  o.note?.let { put("note", it) }
}

private fun decodeAttempt(o: JsonObject) = AttemptLog(
  attempt = intOf(o, "attempt"), plannedBytes = longOf(o, "plannedBytes"), actualBytes = longOf(o, "actualBytes"),
  seconds = doubleOf(o, "seconds"), mode = textOf(o, "mode"),
)

private fun encodeAttempt(a: AttemptLog): JsonObject = buildJsonObject {
  put("attempt", a.attempt)
  put("plannedBytes", a.plannedBytes)
  put("actualBytes", a.actualBytes)
  put("seconds", a.seconds)
  put("mode", a.mode)
}

private fun textOf(o: JsonObject, key: String) = o.getValue(key).jsonPrimitive.content
private fun intOf(o: JsonObject, key: String) = o.getValue(key).jsonPrimitive.int
private fun longOf(o: JsonObject, key: String) = o.getValue(key).jsonPrimitive.long
private fun doubleOf(o: JsonObject, key: String) = o.getValue(key).jsonPrimitive.double
private fun objectOf(o: JsonObject, key: String) = o.getValue(key).jsonObject
