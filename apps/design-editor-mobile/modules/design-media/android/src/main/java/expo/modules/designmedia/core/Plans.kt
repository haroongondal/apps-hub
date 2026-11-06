package expo.modules.designmedia.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

// Mirrors packages/media-core/src/types.ts. DOM parsing, not @Serializable: the serialization
// compiler plugin isn't on the app's Gradle classpath (Deputy avoids it too). Unknown fields are ignored.

data class Rung(val shortSide: Int, val fps: Int)
data class SizeAudio(val mode: String, val bps: Int = 0)

sealed interface Plan {
  val tool: String
}

data class SizePlan(
  val targetBytes: Long, val encoder: String, val rung: Rung, val width: Int, val height: Int,
  val videoBps: Int, val audio: SizeAudio, val overheadBytes: Long, val plannedVideoBytes: Long,
  val plannedBytes: Long, val attempt: Int, val margin: Double, val fpsCap: Int,
) : Plan {
  override val tool get() = "size"
}

data class QualityPlan(val encoder: String, val rung: Rung, val width: Int, val height: Int, val quality: Double) : Plan {
  override val tool get() = "quality"
}

data class ClipPlan(
  val mode: String, val startS: Double, val endS: Double, val keyframeS: Double,
  val container: String, val ext: String, val tracks: List<Int>,
) : Plan {
  override val tool get() = "clip"
}

data class AudioPlan(val trackIndex: Int, val mode: String, val container: String, val ext: String, val bps: Int? = null) : Plan {
  override val tool get() = "audio"
}

data class GifPlan(
  val startS: Double, val endS: Double, val width: Int, val fps: Int, val targetBytes: Long? = null, val attempt: Int = 1,
) : Plan {
  override val tool get() = "gif"
}

data class ConvertVideo(val encoder: String, val quality: Double)
data class ConvertAudio(val codec: String, val bps: Int? = null, val copy: Boolean)
data class ConvertPlan(
  val mode: String, val container: String, val ext: String, val video: ConvertVideo? = null, val audio: ConvertAudio? = null,
) : Plan {
  override val tool get() = "convert"
}

data class FramePlan(val timeS: Double, val format: String, val ext: String) : Plan {
  override val tool get() = "frame"
}

data class Loudness(val inputI: Double, val inputTp: Double, val inputLra: Double, val inputThresh: Double, val offset: Double)

data class VolumePlan(val mode: String, val gainDb: Double, val video: String?, val ext: String, val measured: Loudness? = null) : Plan {
  override val tool get() = "volume"
}

data class ReversePlan(val sound: Boolean, val quality: Double, val ext: String) : Plan {
  override val tool get() = "reverse"
}

data class StabilizePlan(val level: String, val search: Int, val quality: Double, val ext: String) : Plan {
  override val tool get() = "stabilize"
}

// volume and music default so a plan queued before stage 3 still decodes.
data class ComposeClip(val uri: String, val name: String, val inS: Double, val outS: Double, val hasAudio: Boolean, val volume: Double = 1.0)

// startS is the place on the video's timeline; inS and outS are times in the audio file, already cut to the video's end.
data class ComposeMusic(val uri: String, val name: String, val inS: Double, val outS: Double, val startS: Double, val volume: Double)

data class ComposePlan(
  val clips: List<ComposeClip>, val width: Int, val height: Int, val fps: Int, val videoBps: Int, val plannedBytes: Long, val ext: String,
  val music: List<ComposeMusic> = emptyList(),
) : Plan {
  override val tool get() = "compose"
}

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
  val id: String, val inputId: String, val inputName: String, val plan: Plan, val state: JobState,
  val progress: Double, val attempt: Int, val outputs: List<Output>, val error: String? = null,
  val startedAt: Long? = null, val finishedAt: Long? = null, val attempts: List<AttemptLog> = emptyList(),
)

fun decodeJobs(text: String): List<Job> = Json.parseToJsonElement(text).jsonArray.map { decodeJob(it.jsonObject) }

fun encodeJobs(jobs: List<Job>): String = JsonArray(jobs.map { encodeJob(it) }).toString()

fun decodeJob(o: JsonObject): Job = Job(
  id = textOf(o, "id"),
  inputId = textOf(o, "inputId"),
  inputName = textOf(o, "inputName"),
  plan = decodePlan(objectOf(o, "plan")),
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
  put("plan", encodePlan(j.plan))
  put("state", j.state.wire)
  put("progress", j.progress)
  put("attempt", j.attempt)
  put("outputs", JsonArray(j.outputs.map { encodeOutput(it) }))
  j.error?.let { put("error", it) }
  j.startedAt?.let { put("startedAt", it) }
  j.finishedAt?.let { put("finishedAt", it) }
  put("attempts", JsonArray(j.attempts.map { encodeAttempt(it) }))
}

fun decodePlan(o: JsonObject): Plan = when (val tool = textOf(o, "tool")) {
  "size" -> decodeSizePlan(o)
  "quality" -> decodeQualityPlan(o)
  "clip" -> decodeClipPlan(o)
  "audio" -> AudioPlan(intOf(o, "trackIndex"), textOf(o, "mode"), textOf(o, "container"), textOf(o, "ext"), optInt(o, "bps"))
  "gif" -> GifPlan(doubleOf(o, "startS"), doubleOf(o, "endS"), intOf(o, "width"), intOf(o, "fps"), optLong(o, "targetBytes"), intOf(o, "attempt"))
  "convert" -> decodeConvertPlan(o)
  "frame" -> FramePlan(doubleOf(o, "timeS"), textOf(o, "format"), textOf(o, "ext"))
  "volume" -> decodeVolumePlan(o)
  "reverse" -> ReversePlan(o.getValue("sound").jsonPrimitive.boolean, doubleOf(o, "quality"), textOf(o, "ext"))
  "stabilize" -> StabilizePlan(textOf(o, "level"), intOf(o, "search"), doubleOf(o, "quality"), textOf(o, "ext"))
  "compose" -> decodeComposePlan(o)
  else -> throw IllegalArgumentException("Unknown tool: $tool")
}

fun encodePlan(p: Plan): JsonObject = when (p) {
  is SizePlan -> encodeSizePlan(p)
  is QualityPlan -> buildJsonObject {
    put("tool", "quality")
    put("encoder", p.encoder)
    put("rung", buildJsonObject { put("shortSide", p.rung.shortSide); put("fps", p.rung.fps) })
    put("width", p.width)
    put("height", p.height)
    put("quality", p.quality)
  }
  is ClipPlan -> buildJsonObject {
    put("tool", "clip")
    put("mode", p.mode)
    put("startS", p.startS)
    put("endS", p.endS)
    put("keyframeS", p.keyframeS)
    put("container", p.container)
    put("ext", p.ext)
    put("tracks", JsonArray(p.tracks.map { JsonPrimitive(it) }))
  }
  is AudioPlan -> buildJsonObject {
    put("tool", "audio")
    put("trackIndex", p.trackIndex)
    put("mode", p.mode)
    put("container", p.container)
    put("ext", p.ext)
    p.bps?.let { put("bps", it) }
  }
  is GifPlan -> buildJsonObject {
    put("tool", "gif")
    put("startS", p.startS)
    put("endS", p.endS)
    put("width", p.width)
    put("fps", p.fps)
    p.targetBytes?.let { put("targetBytes", it) }
    put("attempt", p.attempt)
  }
  is ConvertPlan -> buildJsonObject {
    put("tool", "convert")
    put("mode", p.mode)
    put("container", p.container)
    put("ext", p.ext)
    p.video?.let { v -> put("video", buildJsonObject { put("encoder", v.encoder); put("quality", v.quality) }) }
    p.audio?.let { a ->
      put("audio", buildJsonObject { put("codec", a.codec); a.bps?.let { put("bps", it) }; put("copy", a.copy) })
    }
  }
  is FramePlan -> buildJsonObject {
    put("tool", "frame")
    put("timeS", p.timeS)
    put("format", p.format)
    put("ext", p.ext)
  }
  is VolumePlan -> buildJsonObject {
    put("tool", "volume")
    put("mode", p.mode)
    put("gainDb", p.gainDb)
    p.video?.let { put("video", it) }
    put("ext", p.ext)
    p.measured?.let { m ->
      put("measured", buildJsonObject {
        put("inputI", m.inputI); put("inputTp", m.inputTp); put("inputLra", m.inputLra)
        put("inputThresh", m.inputThresh); put("offset", m.offset)
      })
    }
  }
  is ReversePlan -> buildJsonObject {
    put("tool", "reverse")
    put("sound", p.sound)
    put("quality", p.quality)
    put("ext", p.ext)
  }
  is StabilizePlan -> buildJsonObject {
    put("tool", "stabilize")
    put("level", p.level)
    put("search", p.search)
    put("quality", p.quality)
    put("ext", p.ext)
  }
  is ComposePlan -> buildJsonObject {
    put("tool", "compose")
    put("clips", JsonArray(p.clips.map { c ->
      buildJsonObject { put("uri", c.uri); put("name", c.name); put("inS", c.inS); put("outS", c.outS); put("hasAudio", c.hasAudio); put("volume", c.volume) }
    }))
    put("music", JsonArray(p.music.map { m ->
      buildJsonObject { put("uri", m.uri); put("name", m.name); put("inS", m.inS); put("outS", m.outS); put("startS", m.startS); put("volume", m.volume) }
    }))
    put("width", p.width)
    put("height", p.height)
    put("fps", p.fps)
    put("videoBps", p.videoBps)
    put("plannedBytes", p.plannedBytes)
    put("ext", p.ext)
  }
}

fun decodeSizePlan(o: JsonObject): SizePlan {
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

private fun decodeQualityPlan(o: JsonObject): QualityPlan {
  val rung = objectOf(o, "rung")
  return QualityPlan(
    textOf(o, "encoder"), Rung(intOf(rung, "shortSide"), intOf(rung, "fps")),
    intOf(o, "width"), intOf(o, "height"), doubleOf(o, "quality"),
  )
}

private fun decodeClipPlan(o: JsonObject) = ClipPlan(
  mode = textOf(o, "mode"), startS = doubleOf(o, "startS"), endS = doubleOf(o, "endS"), keyframeS = doubleOf(o, "keyframeS"),
  container = textOf(o, "container"), ext = textOf(o, "ext"), tracks = o.getValue("tracks").jsonArray.map { it.jsonPrimitive.int },
)

private fun decodeConvertPlan(o: JsonObject): ConvertPlan {
  val video = optObject(o, "video")?.let { ConvertVideo(textOf(it, "encoder"), doubleOf(it, "quality")) }
  val audio = optObject(o, "audio")?.let { ConvertAudio(textOf(it, "codec"), optInt(it, "bps"), it.getValue("copy").jsonPrimitive.boolean) }
  return ConvertPlan(textOf(o, "mode"), textOf(o, "container"), textOf(o, "ext"), video, audio)
}

private fun decodeComposePlan(o: JsonObject) = ComposePlan(
  clips = o.getValue("clips").jsonArray.map {
    val c = it.jsonObject
    ComposeClip(
      textOf(c, "uri"), textOf(c, "name"), doubleOf(c, "inS"), doubleOf(c, "outS"), c.getValue("hasAudio").jsonPrimitive.boolean,
      optDouble(c, "volume") ?: 1.0,
    )
  },
  width = intOf(o, "width"), height = intOf(o, "height"), fps = intOf(o, "fps"), videoBps = intOf(o, "videoBps"),
  plannedBytes = longOf(o, "plannedBytes"), ext = textOf(o, "ext"),
  music = present(o, "music")?.jsonArray?.map {
    val m = it.jsonObject
    ComposeMusic(textOf(m, "uri"), textOf(m, "name"), doubleOf(m, "inS"), doubleOf(m, "outS"), doubleOf(m, "startS"), doubleOf(m, "volume"))
  } ?: emptyList(),
)

private fun decodeVolumePlan(o: JsonObject): VolumePlan {
  val measured = optObject(o, "measured")?.let {
    Loudness(doubleOf(it, "inputI"), doubleOf(it, "inputTp"), doubleOf(it, "inputLra"), doubleOf(it, "inputThresh"), doubleOf(it, "offset"))
  }
  return VolumePlan(textOf(o, "mode"), doubleOf(o, "gainDb"), optText(o, "video"), textOf(o, "ext"), measured)
}

// Absent optional fields are left out, so they reach JS as undefined, which is what NativeJobStatus declares.
fun Job.toStatusMap(): Map<String, Any?> = listOf(
  "id" to id,
  "state" to state.wire,
  "progress" to progress,
  "attempt" to attempt,
  "outputs" to outputs.map { listOf("name" to it.name, "ref" to it.ref, "bytes" to it.bytes, "note" to it.note).toMapWithoutNulls() },
  "error" to error,
  "attempts" to attempts.map {
    mapOf("attempt" to it.attempt, "plannedBytes" to it.plannedBytes, "actualBytes" to it.actualBytes,
      "seconds" to it.seconds, "mode" to it.mode)
  },
  "tool" to plan.tool,
  "inputName" to inputName,
  "startedAt" to startedAt,
  "finishedAt" to finishedAt,
).toMapWithoutNulls()

private fun List<Pair<String, Any?>>.toMapWithoutNulls(): Map<String, Any?> = filter { it.second != null }.toMap()

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

private fun present(o: JsonObject, key: String): JsonElement? = o[key]?.takeUnless { it is JsonNull }

private fun optText(o: JsonObject, key: String) = present(o, key)?.jsonPrimitive?.content
private fun optInt(o: JsonObject, key: String) = present(o, key)?.jsonPrimitive?.int
private fun optLong(o: JsonObject, key: String) = present(o, key)?.jsonPrimitive?.long
private fun optDouble(o: JsonObject, key: String) = present(o, key)?.jsonPrimitive?.double
private fun optObject(o: JsonObject, key: String) = present(o, key)?.jsonObject
private fun textOf(o: JsonObject, key: String) = o.getValue(key).jsonPrimitive.content
private fun intOf(o: JsonObject, key: String) = o.getValue(key).jsonPrimitive.int
private fun longOf(o: JsonObject, key: String) = o.getValue(key).jsonPrimitive.long
private fun doubleOf(o: JsonObject, key: String) = o.getValue(key).jsonPrimitive.double
private fun objectOf(o: JsonObject, key: String) = o.getValue(key).jsonObject
