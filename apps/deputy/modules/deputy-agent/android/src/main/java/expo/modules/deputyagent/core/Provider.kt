package expo.modules.deputyagent.core

import java.io.IOException
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** `inputTokens` includes `cachedTokens`, as OpenAI-style `prompt_tokens` does. */
data class Usage(val inputTokens: Long, val cachedTokens: Long, val outputTokens: Long)

data class Msg(val role: String, val json: JsonObject)

data class ToolSpec(val name: String, val description: String, val parameters: JsonObject)

data class ToolCall(val id: String, val name: String, val args: JsonObject)

data class ModelTurn(val raw: Msg, val toolCalls: List<ToolCall>, val usage: Usage, val text: String?)

interface LlmProvider {
  suspend fun step(history: List<Msg>, tools: List<ToolSpec>): ModelTurn
}

object Msgs {
  fun system(text: String) = Msg("system", buildJsonObject { put("role", "system"); put("content", text) })

  fun user(text: String, jpegBase64: String? = null) = Msg(
    "user",
    buildJsonObject {
      put("role", "user")
      if (jpegBase64 == null) {
        put("content", text)
      } else {
        put(
          "content",
          JsonArray(
            listOf(
              buildJsonObject { put("type", "text"); put("text", text) },
              buildJsonObject { put("type", "image_url"); put("image_url", buildJsonObject { put("url", "data:image/jpeg;base64,$jpegBase64") }) },
            ),
          ),
        )
      }
    },
  )

  fun tool(callId: String, content: String) =
    Msg("tool", buildJsonObject { put("role", "tool"); put("tool_call_id", callId); put("content", content) })
}

object ProviderJson {
  fun request(model: String, history: List<Msg>, tools: List<ToolSpec>, reasoningEffort: String?): String = buildJsonObject {
    put("model", model)
    put("messages", JsonArray(history.map { it.json }))
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
      put("tool_choice", "auto")
    }
    reasoningEffort?.let { put("reasoning_effort", it) }
  }.toString()

  /**
   * The assistant message is replayed with its standard fields only, since Groq refuses unknown ones. Gemini's thought
   * signature rides inside `tool_calls` and OpenRouter's in `reasoning_details`, so both come back untouched (SPEC §9.3).
   */
  fun parse(body: String): ModelTurn = try {
    val root = Json.parseToJsonElement(body).jsonObject
    val message = root["choices"]!!.jsonArray.first().jsonObject["message"]!!.jsonObject
    val calls = (message["tool_calls"] as? JsonArray).orEmpty().map { tc ->
      val fn = tc.jsonObject["function"]!!.jsonObject
      val args = when (val a = fn["arguments"]) {
        is JsonObject -> a
        is JsonPrimitive -> runCatching { Json.parseToJsonElement(a.content).jsonObject }.getOrNull()
        else -> null
      }
      ToolCall(tc.jsonObject["id"]?.jsonPrimitive?.contentOrNull.orEmpty(), fn["name"]!!.jsonPrimitive.content, args ?: JsonObject(emptyMap()))
    }
    val usage = root["usage"] as? JsonObject
    fun count(o: JsonObject?, k: String) = (o?.get(k) as? JsonPrimitive)?.longOrNull ?: 0
    ModelTurn(
      raw = Msg("assistant", JsonObject(message.filterKeys { it in REPLAYED })),
      toolCalls = calls,
      usage = Usage(count(usage, "prompt_tokens"), count(usage?.get("prompt_tokens_details") as? JsonObject, "cached_tokens"), count(usage, "completion_tokens")),
      text = (message["content"] as? JsonPrimitive)?.contentOrNull,
    )
  } catch (e: RuntimeException) {
    throw ProviderError(ProviderError.Kind.SERVER, "The model sent a reply Deputy couldn't read.")
  }
}

private val REPLAYED = setOf("role", "content", "tool_calls", "reasoning_details")

/** `retryAfterMs` is the server's `retry-after`, sent with a 429. */
data class HttpReply(val code: Int, val body: String, val retryAfterMs: Long? = null)

class ProviderError(val kind: Kind, message: String) : Exception(message) {
  enum class Kind { AUTH, BAD_REQUEST, SERVER, OFFLINE }
}

/** SPEC §9.2 and §9.4. `post` is the transport, so request shape and retries run in JVM tests. */
class OpenAiCompatProvider(
  private val baseUrl: String,
  private val model: String,
  private val key: String,
  private val reasoningEffort: String?,
  private val post: suspend (url: String, headers: Map<String, String>, body: String) -> HttpReply,
) : LlmProvider {
  override suspend fun step(history: List<Msg>, tools: List<ToolSpec>): ModelTurn {
    if (key.isBlank()) throw ProviderError(ProviderError.Kind.AUTH, "No API key is set. Add your API key in Settings.")
    val url = baseUrl.trimEnd('/') + "/chat/completions"
    val headers = mapOf("Authorization" to "Bearer $key", "Content-Type" to "application/json")
    val body = ProviderJson.request(model, history, tools, reasoningEffort)
    for (attempt in 0..RETRY_DELAYS.size) {
      val last = attempt == RETRY_DELAYS.size
      val reply = try {
        post(url, headers, body)
      } catch (e: IOException) {
        if (last) throw ProviderError(ProviderError.Kind.OFFLINE, "Deputy couldn't reach the model. Check the phone's connection and try again.")
        null
      }
      when {
        reply == null -> Unit
        reply.code in 200..299 -> return ProviderJson.parse(reply.body)
        reply.code == 401 || reply.code == 403 ->
          throw ProviderError(ProviderError.Kind.AUTH, "The model refused the API key (HTTP ${reply.code}). Check your API key in Settings.")
        reply.code == 429 && last ->
          throw ProviderError(ProviderError.Kind.SERVER, "The model's rate limit was reached (HTTP 429). Wait a minute, or check your plan's limits.")
        reply.code >= 500 && last -> throw ProviderError(ProviderError.Kind.SERVER, "The model is busy or failing (HTTP ${reply.code}). Try again later.")
        // Groq answers a tool call the model wrote badly with a 400; a second try usually comes out right.
        reply.code == 429 || reply.code >= 500 || (!last && "tool_use_failed" in reply.body) -> Unit
        else -> throw ProviderError(
          ProviderError.Kind.BAD_REQUEST,
          "The model rejected the request (HTTP ${reply.code}): " + reply.body.replace(key, "[key]").take(2_000),
        )
      }
      delay(reply?.retryAfterMs?.coerceIn(0, MAX_WAIT_MS) ?: RETRY_DELAYS[attempt])
    }
    error("unreachable")
  }

  private companion object {
    val RETRY_DELAYS = listOf(1_000L, 2_000L, 4_000L)
    const val MAX_WAIT_MS = 60_000L
  }
}
