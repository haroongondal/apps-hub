package expo.modules.aihubcore.core

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

class BadRequest(val requestId: String, message: String) : Exception(message)

data class Request(
  val requestId: String,
  val job: Job,
  val priority: Priority,
  val messages: List<Msg> = emptyList(),
  val tools: List<ToolSpec> = emptyList(),
  val texts: List<String> = emptyList(),
  val maxTokens: Int = DEFAULT_MAX_TOKENS,
  val fileName: String? = null,
  val mime: String? = null,
  val dimensions: Int? = null,
  val segments: Boolean = false,
) {
  val attachmentCap: Int?
    get() = when (job) {
      Job.VISION -> MAX_IMAGE_BYTES
      Job.TRANSCRIBE -> MAX_AUDIO_BYTES
      else -> null
    }

  val attachmentName: String
    get() = when (job) {
      Job.VISION -> "picture"
      Job.TRANSCRIBE -> "audio file"
      else -> "request"
    }

  // Null when the attachment can be read: a regular file (a pipe or socket could block the read forever) within the cap.
  fun attachmentProblem(isRegularFile: Boolean, size: Long): String? {
    val cap = attachmentCap ?: return null
    return when {
      !isRegularFile -> "Send the picture or audio as a file."
      size > cap -> "The $attachmentName is over ${cap / (1024 * 1024)} MB. Send a smaller one."
      else -> null
    }
  }

  companion object {
    const val MAX_JSON_BYTES = 512 * 1024
    const val MAX_TEXTS = 8
    const val MAX_TOKENS = 8192
    const val DEFAULT_MAX_TOKENS = 2048
    const val MAX_IMAGE_BYTES = 7 * 1024 * 1024
    const val MAX_AUDIO_BYTES = 25 * 1024 * 1024
    // Sizes gemini-embedding-001 documents for output dimensionality; anything else is rounded up to the next one.
    val DIMENSIONS = listOf(128, 256, 512, 768, 1536, 3072)

    fun dimensionsFor(asked: Int): Int = DIMENSIONS.firstOrNull { it >= asked } ?: DIMENSIONS.last()

    private val ID = Regex("[A-Za-z0-9_-]{1,64}")
    private val MIME = Regex("[\\w.+-]+/[\\w.+-]+")
    private val ROLES = setOf("system", "user", "assistant", "tool")
    private val JOBS = mapOf("chat" to Job.CHAT, "vision" to Job.VISION, "embed" to Job.EMBED, "transcribe" to Job.TRANSCRIBE)
    private val PRIORITIES = mapOf("foreground" to Priority.FOREGROUND, "background" to Priority.BACKGROUND)

    fun idOf(json: String?): String {
      val root = rootOf(json) ?: return ""
      return root.str("requestId")?.takeIf { ID.matches(it) }.orEmpty()
    }

    fun parse(json: String): Request {
      if (json.toByteArray().size > MAX_JSON_BYTES) {
        throw BadRequest("", "The request is over 512 KB. Send images and audio as the attachment.")
      }
      val root = rootOf(json) ?: throw BadRequest("", "The request isn't a JSON object.")
      val id = root.str("requestId")?.takeIf { ID.matches(it) }
        ?: throw BadRequest("", "The requestId must be 1 to 64 letters, digits, - or _.")
      fun bad(message: String): Nothing = throw BadRequest(id, message)

      val version = root.int("apiVersion") ?: bad("The request has no apiVersion.")
      if (version < 1) bad("apiVersion $version is unknown. This hub speaks version ${ApiVersion.CURRENT}.")
      if (version > ApiVersion.CURRENT) bad("This app needs a newer AI hub (apiVersion $version). Update AI hub from the Store.")
      val job = JOBS[root.str("job")] ?: bad("The job must be chat, vision, embed or transcribe.")
      val priority = PRIORITIES[root.str("priority")] ?: bad("The priority must be foreground or background.")
      val name = job.name.lowercase()

      return when (job) {
        Job.CHAT, Job.VISION -> {
          val messages = messagesOf(root["messages"]) ?: bad("A $name request needs messages: a list of {role, content}.")
          val tools = if (root["tools"] == null) emptyList() else toolsOf(root["tools"]) ?: bad("Each tool needs a name and parameters.")
          val maxTokens = if (root["maxTokens"] == null) DEFAULT_MAX_TOKENS else {
            root.int("maxTokens")?.takeIf { it in 1..MAX_TOKENS } ?: bad("maxTokens must be a whole number from 1 to $MAX_TOKENS.")
          }
          var mime: String? = null
          if (job == Job.VISION) {
            if (messages.none { it.role == "user" }) bad("A vision request needs a user message to carry the image.")
            mime = root.str("mime")?.takeIf { it.startsWith("image/") && MIME.matches(it) }
              ?: bad("A vision request needs mime: the attached image's type, such as image/jpeg.")
          }
          Request(id, job, priority, messages = messages, tools = tools, maxTokens = maxTokens, mime = mime)
        }
        Job.EMBED -> {
          val texts = (root["texts"] as? JsonArray)?.map { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
          if (texts == null || texts.isEmpty() || texts.any { it.isNullOrEmpty() }) bad("An embed request needs texts: a list of non-empty strings.")
          if (texts.size > MAX_TEXTS) bad("An embed request takes at most $MAX_TEXTS texts. Split it into smaller batches.")
          val dimensions = if (root["dimensions"] == null) null else {
            root.int("dimensions")?.takeIf { it > 0 }?.let(::dimensionsFor) ?: bad("dimensions must be a whole number above 0, such as 768.")
          }
          Request(id, job, priority, texts = texts.map { it!! }, dimensions = dimensions)
        }
        Job.TRANSCRIBE -> {
          val fileName = root.str("fileName")?.takeIf { it.isNotBlank() } ?: bad("A transcribe request needs fileName, such as note.m4a.")
          val mime = root.str("mime")?.takeIf { MIME.matches(it) } ?: bad("A transcribe request needs mime: the audio's type, such as audio/mp4.")
          val segments = if (root["segments"] == null) false else {
            (root["segments"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: bad("segments must be true or false.")
          }
          Request(id, job, priority, fileName = fileName, mime = mime, segments = segments)
        }
      }
    }

    private fun rootOf(json: String?): JsonObject? = try {
      Json.parseToJsonElement(json ?: "") as? JsonObject
    } catch (e: Exception) {
      null
    }

    private fun messagesOf(e: JsonElement?): List<Msg>? {
      val list = (e as? JsonArray)?.takeIf { it.isNotEmpty() } ?: return null
      return list.map { m ->
        val o = m as? JsonObject ?: return null
        val role = o.str("role")?.takeIf { it in ROLES } ?: return null
        Msg(role, o)
      }
    }

    private fun toolsOf(e: JsonElement?): List<ToolSpec>? = (e as? JsonArray)?.map { t ->
      val o = t as? JsonObject ?: return null
      val name = o.str("name")?.takeIf { it.isNotBlank() } ?: return null
      val parameters = o["parameters"] as? JsonObject ?: return null
      ToolSpec(name, o.str("description").orEmpty(), parameters)
    }
  }
}

private fun JsonObject.str(key: String): String? = (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.int(key: String): Int? = (get(key) as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull

// Puts the attached image into the last user message, as the OpenAI image_url part both services read.
fun withImage(messages: List<Msg>, mime: String, base64: String): List<Msg> {
  val i = messages.indexOfLast { it.role == "user" }
  val m = messages[i]
  val image = buildJsonObject { put("type", "image_url"); put("image_url", buildJsonObject { put("url", "data:$mime;base64,$base64") }) }
  val parts = when (val c = m.json["content"]) {
    is JsonArray -> c + image
    is JsonPrimitive -> listOfNotNull(c.contentOrNull?.let { t -> buildJsonObject { put("type", "text"); put("text", t) } }, image)
    else -> listOf(image)
  }
  return messages.toMutableList().apply { set(i, Msg("user", JsonObject(m.json + ("content" to JsonArray(parts))))) }
}

// Sized to the file's own size up front, so a file that does not grow is read with no regrowth and no final copy.
private class SizedBuffer(size: Int) : ByteArrayOutputStream(size) {
  fun bytes(): ByteArray = if (count == buf.size) buf else toByteArray()
}

fun readCapped(input: InputStream, cap: Int, expected: Long = 0, stop: () -> Boolean = { false }): ByteArray? {
  val out = SizedBuffer(expected.coerceIn(0, cap.toLong()).toInt())
  val buf = ByteArray(64 * 1024)
  while (true) {
    if (stop()) throw CancellationException("The read was stopped.")
    val n = input.read(buf)
    if (n < 0) return out.bytes()
    if (out.size() + n > cap) return null
    out.write(buf, 0, n)
  }
}

fun vectorBytes(v: FloatArray): ByteArray =
  ByteBuffer.allocate(v.size * 4).order(ByteOrder.LITTLE_ENDIAN).apply { asFloatBuffer().put(v) }.array()

fun decideCallers(pkgs: List<String>, sameSignature: Boolean, switches: Map<String, Boolean>, hubPackage: String): Decision =
  if (pkgs.isEmpty()) {
    Decision.Deny("AI hub couldn't tell which app is calling.")
  } else {
    pkgs.map { CallerPolicy.decide(it, sameSignature, switches, hubPackage) }.firstOrNull { it is Decision.Deny } ?: Decision.Allow
  }

object Results {
  fun chat(t: ModelTurn): String = buildJsonObject {
    put("text", t.text)
    put("toolCalls", JsonArray(t.toolCalls.map { c -> buildJsonObject { put("id", c.id); put("name", c.name); put("args", c.args) } }))
    put("usage", buildJsonObject {
      put("inputTokens", t.usage.inputTokens)
      put("cachedTokens", t.usage.cachedTokens)
      put("outputTokens", t.usage.outputTokens)
    })
    put("model", t.served.model)
  }.toString()

  // Each vector as base64 of little-endian float32: JSON numbers would push 8 large vectors past the Binder limit.
  fun embed(vectors: List<FloatArray>, model: String, base64: (ByteArray) -> String): String = buildJsonObject {
    put("vectorsB64", JsonArray(vectors.map { JsonPrimitive(base64(vectorBytes(it))) }))
    put("dims", vectors.firstOrNull()?.size ?: 0)
    put("model", model)
  }.toString()

  fun transcribe(t: Transcript): String = buildJsonObject {
    put("text", t.text)
    t.segments?.let { list ->
      put("segments", JsonArray(list.map { g -> buildJsonObject { put("start", g.start); put("end", g.end); put("text", g.text) } }))
    }
  }.toString()
}

object Settings {
  fun key(s: Service): String = s.name.lowercase()

  fun models(json: String?): Map<Job, ModelChoice> {
    val root = try { Json.parseToJsonElement(json ?: "").jsonObject } catch (e: Exception) { null }
    return Job.entries.associateWith { job ->
      val o = root?.entries?.firstOrNull { it.key.equals(job.name, ignoreCase = true) }?.value as? JsonObject
      val service = Service.entries.firstOrNull { it.name.equals(o?.str("service"), ignoreCase = true) }
      val model = o?.str("model")?.takeIf { it.isNotBlank() }
      if (service != null && model != null && allowed(job, service)) ModelChoice(service, model) else job.default
    }
  }

  // Only CHAT runs on both services; the other jobs exist on their default service alone.
  fun allowed(job: Job, service: Service): Boolean = job == Job.CHAT || service == job.default.service

  fun switches(json: String?): Map<String, Boolean> = try {
    Json.parseToJsonElement(json ?: "").jsonObject.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.booleanOrNull?.let { k to it } }.toMap()
  } catch (e: Exception) {
    emptyMap()
  }

  fun status(keys: Map<Service, Int>, heldUntil: Map<Service, Long?>, models: Map<Job, ModelChoice>): String = buildJsonObject {
    put("apiVersion", ApiVersion.CURRENT)
    put("services", buildJsonObject {
      Service.entries.forEach { s ->
        put(key(s), buildJsonObject {
          put("keys", keys[s] ?: 0)
          put("heldUntil", heldUntil[s]?.let(::JsonPrimitive) ?: JsonNull)
        })
      }
    })
    put("models", buildJsonObject {
      models.forEach { (job, c) -> put(job.name.lowercase(), buildJsonObject { put("service", key(c.service)); put("model", c.model) }) }
    })
  }.toString()
}
