package expo.modules.aihubcore.core

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.float
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

data class TokenUsage(val inputTokens: Long, val cachedTokens: Long, val outputTokens: Long)

data class Msg(val role: String, val json: JsonObject) {
  val hasImage: Boolean
    get() = (json["content"] as? JsonArray)?.any { (it as? JsonObject)?.get("type")?.jsonPrimitive?.contentOrNull == "image_url" } == true

  // Gemini 3 puts its thought signature in a tool call's extra_content; only Gemini can take that history back.
  val hasProviderExtras: Boolean
    get() = (json["tool_calls"] as? JsonArray)?.any { (it as? JsonObject)?.containsKey("extra_content") == true } == true
}

data class Segment(val start: Double, val end: Double, val text: String)

// `segments` is null unless the caller asked for them.
data class Transcript(val text: String, val segments: List<Segment>? = null)

data class ToolSpec(val name: String, val description: String, val parameters: JsonObject)

data class ToolCall(val id: String, val name: String, val args: JsonObject)

data class ModelTurn(val raw: Msg, val toolCalls: List<ToolCall>, val usage: TokenUsage, val text: String?, val served: ModelChoice)

object Msgs {
  fun system(text: String) = Msg("system", buildJsonObject { put("role", "system"); put("content", text) })

  fun user(text: String, jpegBase64: List<String> = emptyList()) = Msg(
    "user",
    buildJsonObject {
      put("role", "user")
      if (jpegBase64.isEmpty()) {
        put("content", text)
      } else {
        val image = { b64: String -> buildJsonObject { put("type", "image_url"); put("image_url", buildJsonObject { put("url", "data:image/jpeg;base64,$b64") }) } }
        put("content", JsonArray(listOf(buildJsonObject { put("type", "text"); put("text", text) }) + jpegBase64.map(image)))
      }
    },
  )

  fun tool(callId: String, content: String) =
    Msg("tool", buildJsonObject { put("role", "tool"); put("tool_call_id", callId); put("content", content) })
}

object ProviderJson {
  fun chatRequest(
    choice: ModelChoice,
    messages: List<Msg>,
    tools: List<ToolSpec>,
    maxTokens: Int,
    reasoningEffort: String?,
    toolChoice: String?,
  ): String = buildJsonObject {
    put("model", choice.model)
    put("messages", JsonArray(messages.map { it.json }))
    if (tools.isNotEmpty()) {
      put(
        "tools",
        JsonArray(
          tools.map { t ->
            buildJsonObject {
              put("type", "function")
              put("function", buildJsonObject { put("name", t.name); put("description", t.description); put("parameters", t.parameters) })
            }
          },
        ),
      )
      toolChoice?.let { put("tool_choice", it) }
    }
    // Gemini's OpenAI endpoint takes max_tokens and has no reasoning_effort.
    if (choice.service == Service.GEMINI) {
      put("max_tokens", maxTokens)
    } else {
      put("max_completion_tokens", maxTokens)
      reasoningEffort?.let { put("reasoning_effort", it) }
    }
  }.toString()

  fun parseChat(body: String, served: ModelChoice): ModelTurn = readable(served.service, body) {
    val root = Json.parseToJsonElement(body).jsonObject
    val message = root["choices"]!!.jsonArray.first().jsonObject["message"]!!.jsonObject
    val calls = (message["tool_calls"] as? JsonArray).orEmpty().map { tc ->
      val fn = tc.jsonObject["function"]!!.jsonObject
      val args = when (val a = fn["arguments"]) {
        is JsonObject -> a
        is JsonPrimitive -> runCatching { Json.parseToJsonElement(a.content).jsonObject }.getOrNull()
        else -> null
      }
      val name = fn["name"]!!.jsonPrimitive.content.substringAfterLast('.')
      ToolCall(tc.jsonObject["id"]?.jsonPrimitive?.contentOrNull.orEmpty(), name, args ?: JsonObject(emptyMap()))
    }
    val usage = root["usage"] as? JsonObject
    fun count(o: JsonObject?, k: String) = (o?.get(k) as? JsonPrimitive)?.longOrNull ?: 0
    ModelTurn(
      raw = Msg("assistant", JsonObject(message.filterKeys { it in REPLAYED })),
      toolCalls = calls,
      usage = TokenUsage(count(usage, "prompt_tokens"), count(usage?.get("prompt_tokens_details") as? JsonObject, "cached_tokens"), count(usage, "completion_tokens")),
      text = (message["content"] as? JsonPrimitive)?.contentOrNull,
      served = served,
    )
  }

  fun multipart(boundary: String, fields: Map<String, String>, fileName: String, mime: String, file: ByteArray): ByteArray {
    val out = ByteArrayOutputStream()
    fun w(s: String) = out.write(s.toByteArray())
    for ((k, v) in fields) w("--$boundary\r\nContent-Disposition: form-data; name=\"$k\"\r\n\r\n$v\r\n")
    val name = fileName.replace(Regex("[\"\\\\\r\n]"), "_")
    val type = if (MIME.matches(mime)) mime else "application/octet-stream"
    w("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$name\"\r\nContent-Type: $type\r\n\r\n")
    out.write(file)
    w("\r\n--$boundary--\r\n")
    return out.toByteArray()
  }

  // The reply came back 2xx but did not parse, so it is logged as HTTP 200 with its shape (field names and counts, never values).
  inline fun <T> readable(service: Service, body: String, wanted: Int? = null, block: () -> T): T = try {
    block()
  } catch (e: RuntimeException) {
    throw AiError(AiError.Kind.SERVER, "${service.label} sent a reply AI hub couldn't read. Try again later.", service = service, httpCode = 200, detail = shapeOf(body, wanted))
  }

  fun shapeOf(body: String, wanted: Int? = null): String = try {
    val root = Json.parseToJsonElement(body).jsonObject
    val data = root["data"] as? JsonArray
    val first = data?.firstOrNull() as? JsonObject
    val vector = first?.get("embedding")
    "fields " + root.keys.take(6).joinToString(",").take(60) + (data?.let { ", data ${it.size}" } ?: "") + (wanted?.let { " of $it texts" } ?: "") +
      (first?.let { ", item " + it.keys.take(4).joinToString(",").take(40) } ?: "") +
      (vector?.let { ", embedding " + ((it as? JsonArray)?.let { a -> "array ${a.size}" + if ((a.firstOrNull() as? JsonPrimitive)?.isString == true) " of strings" else "" } ?: "not an array") } ?: "")
  } catch (e: Exception) {
    "not JSON, ${body.length} bytes"
  }

  private val REPLAYED = setOf("role", "content", "tool_calls", "reasoning_details")
  private val MIME = Regex("[\\w.+-]+/[\\w.+-]+")
}

class Provider(
  private val ring: KeyRing,
  private val transport: Transport,
  private val sleep: (Long) -> Unit = Thread::sleep,
) {
  fun chat(
    choice: ModelChoice,
    messages: List<Msg>,
    tools: List<ToolSpec> = emptyList(),
    maxTokens: Int,
    reasoningEffort: String? = null,
    toolChoice: String? = null,
    allowFallback: Boolean = true,
  ): ModelTurn {
    val fallback = if (!allowFallback || messages.any { it.hasImage }) null else fallbackFor(Job.CHAT, choice.service)
    val (served, body) = send(listOfNotNull(choice, fallback), "chat/completions", JSON) {
      ProviderJson.chatRequest(it, messages, tools, maxTokens, reasoningEffort, toolChoice).toByteArray()
    }
    return ProviderJson.parseChat(body, served)
  }

  fun embed(choice: ModelChoice, texts: List<String>, dimensions: Int? = null): List<FloatArray> {
    val request = buildJsonObject {
      put("model", choice.model)
      put("input", JsonArray(texts.map(::JsonPrimitive)))
      dimensions?.let { put("dimensions", it) }
    }.toString().toByteArray()
    val (_, body) = send(listOf(choice), "embeddings", JSON) { request }
    return ProviderJson.readable(choice.service, body, texts.size) {
      val items = Json.parseToJsonElement(body).jsonObject["data"]!!.jsonArray.map { it.jsonObject }
      require(items.size == texts.size)
      // Gemini's OpenAI endpoint may leave `index` out; then the items are in input order already.
      val indexes = items.map { (it["index"] as? JsonPrimitive)?.intOrNull }
      val data = if (indexes.all { it != null }) items.sortedBy { (it["index"] as JsonPrimitive).int } else items
      data.map { d -> d["embedding"]!!.jsonArray.map { it.jsonPrimitive.float }.toFloatArray() }
    }
  }

  fun transcribe(choice: ModelChoice, audio: ByteArray, fileName: String, mime: String, segments: Boolean = false): Transcript {
    val boundary = "aihub-${UUID.randomUUID()}"
    val fields = if (segments) mapOf("model" to choice.model, "response_format" to "verbose_json") else mapOf("model" to choice.model)
    val request = ProviderJson.multipart(boundary, fields, fileName, mime, audio)
    val (_, body) = send(listOf(choice), "audio/transcriptions", "multipart/form-data; boundary=$boundary") { request }
    return ProviderJson.readable(choice.service, body) {
      val root = Json.parseToJsonElement(body).jsonObject
      val parts = if (!segments) null else root["segments"]!!.jsonArray.map { g ->
        val o = g.jsonObject
        Segment(o["start"]!!.jsonPrimitive.double, o["end"]!!.jsonPrimitive.double, o["text"]!!.jsonPrimitive.content)
      }
      Transcript(root["text"]!!.jsonPrimitive.content, parts)
    }
  }

  private fun send(choices: List<ModelChoice>, path: String, contentType: String, request: (ModelChoice) -> ByteArray): Pair<ModelChoice, String> {
    val usable = choices.filter { ring.keys(it.service).isNotEmpty() }
    val first = choices.first()
    if (usable.isEmpty()) throw AiError(AiError.Kind.AUTH, "No ${first.service.label} key is set. Add one in AI hub.", service = first.service)
    val names = usable.joinToString(" and ") { it.service.label }
    var waits = 0
    var refusedCode = 0
    val refused = mutableSetOf<String>()
    while (true) {
      var wait: Long? = null
      for (choice in usable) {
        val body = request(choice)
        for (i in ring.order(choice.service)) {
          val key = ring.keys(choice.service)[i]
          if (key in refused) continue
          val reply = post(choice.service, key, path, body, contentType)
          when (verdictOf(reply)) {
            Verdict.SUCCESS -> {
              ring.use(choice.service, i)
              return choice to reply.body
            }
            Verdict.NEXT_KEY -> if (isLimited(reply)) {
              wait = minOf(wait ?: Long.MAX_VALUE, waitFor(reply))
            } else {
              refused += key
              refusedCode = reply.code
            }
            Verdict.STOP -> {
              ring.use(choice.service, i)
              throw stopped(choice.service, reply, choice != first)
            }
          }
        }
      }
      if (exhausted(wait != null) == Exhausted.REFUSED) {
        throw AiError(AiError.Kind.AUTH, "$names refused every key (HTTP $refusedCode). Check your $names keys in AI hub.", service = usable.last().service, httpCode = refusedCode, fellBack = usable.size > 1)
      }
      if (waits++ == MAX_RATE_WAITS) {
        throw AiError(AiError.Kind.RATE, "Every $names key is at its rate limit. Wait a minute and try again, or add another key in AI hub.", wait, usable.last().service, 429, usable.size > 1)
      }
      sleep(wait!!)
    }
  }

  private fun post(service: Service, key: String, path: String, body: ByteArray, contentType: String): HttpReply {
    val headers = mapOf("Authorization" to "Bearer $key")
    var attempt = 0
    var redone = false
    while (true) {
      val reply = try {
        transport.post(service.baseUrl + path, headers, body, contentType)
      } catch (e: SocketTimeoutException) {
        // A read timeout means the model has the request and bills it, so it is never sent again.
        throw AiError(AiError.Kind.TIMEOUT, "${service.label} took too long to answer. Try again later.", service = service)
      } catch (e: IOException) {
        if (attempt == RETRY_DELAYS.size) throw AiError(AiError.Kind.OFFLINE, "AI hub couldn't reach ${service.label}. Check the phone's connection and try again.", service = service)
        sleep(RETRY_DELAYS[attempt++])
        continue
      }
      if (reply.code == 400 && !redone && GROQ_MALFORMED_OUTPUT.containsMatchIn(reply.body)) {
        redone = true
        continue
      }
      return reply
    }
  }

  private fun stopped(service: Service, r: HttpReply, fellBack: Boolean): AiError = when {
    r.code in GATEWAY_TIMEOUTS -> AiError(AiError.Kind.TIMEOUT, "${service.label} took too long to answer. Try again later.", service = service, httpCode = r.code, fellBack = fellBack)
    r.code >= 500 -> AiError(AiError.Kind.SERVER, "${service.label} is busy or failing (HTTP ${r.code}). Try again later.", service = service, httpCode = r.code, fellBack = fellBack)
    else -> AiError(
      AiError.Kind.BAD_REQUEST,
      "${service.label} rejected the request (HTTP ${r.code}): " + ring.all.fold(r.body) { b, k -> b.replace(k, "[key]") }.take(2_000),
      service = service,
      httpCode = r.code,
      fellBack = fellBack,
    )
  }

  private fun waitFor(r: HttpReply): Long =
    (r.retryAfterMs ?: RETRY_DELAY.find(r.body)?.groupValues?.get(1)?.toDouble()?.let { (it * 1_000).toLong() } ?: RATE_WAIT_MS).coerceIn(0, MAX_WAIT_MS)

  private companion object {
    const val JSON = "application/json"
    val RETRY_DELAYS = listOf(1_000L, 2_000L, 4_000L)
    const val MAX_RATE_WAITS = 2
    const val RATE_WAIT_MS = 10_000L
    const val MAX_WAIT_MS = 60_000L
    val GATEWAY_TIMEOUTS = setOf(504, 524)
    val RETRY_DELAY = Regex(""""retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"""")
    val GROQ_MALFORMED_OUTPUT = Regex("tool_use_failed|output_parse_failed")
  }
}
