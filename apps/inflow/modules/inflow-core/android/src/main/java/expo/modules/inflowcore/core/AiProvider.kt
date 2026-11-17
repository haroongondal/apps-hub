package expo.modules.inflowcore.core

import java.io.IOException
import java.net.SocketTimeoutException
import java.net.URI
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

// Copied and trimmed from Deputy's Provider.kt, Settings.kt and Guard.kt (never imported across apps): no tools, no images, no coroutines.

/** `inputTokens` includes `cachedTokens`, as OpenAI-style `prompt_tokens` does. */
data class Usage(val inputTokens: Long, val cachedTokens: Long, val outputTokens: Long)

/** `retryAfterMs` is the server's `retry-after`, sent with a 429. */
data class HttpReply(val code: Int, val body: String, val retryAfterMs: Long? = null)

class AiError(val kind: Kind, message: String) : Exception(message) {
  enum class Kind { AUTH, BAD_REQUEST, SERVER, OFFLINE, TIMEOUT }
}

/** `inputChars` is the length of the request, so a reply without `usage` can still be counted. */
data class AiReply(val text: String, val usage: Usage, val inputChars: Int = 0)

/** `post` is the transport (it throws IOException when the network fails), so request shape and retries run in JVM tests. `keys` are the owner's for this address. */
class OpenAiCompatProvider(
  private val baseUrl: String,
  private val model: String,
  private val keys: List<String>,
  private val effort: String?,
  private val post: (url: String, headers: Map<String, String>, body: String) -> HttpReply,
  private val sleep: (Long) -> Unit = Thread::sleep,
) {
  private var current = 0 // the key in use; it changes only when that key reaches its limit

  fun complete(system: String, user: String, maxTokens: Int = MAX_TOKENS): AiReply {
    if (keys.isEmpty() || keys.any(String::isBlank)) throw AiError(AiError.Kind.AUTH, "No API key is set. Add your API key in Settings.")
    val url = baseUrl.trimEnd('/') + "/chat/completions"
    val body = request(system, user, maxTokens)
    var attempt = 0
    var limited = 0 // keys that answered 429 in a row since the last wait
    while (true) {
      val last = attempt == RETRY_DELAYS.size
      val headers = mapOf("Authorization" to "Bearer ${keys[current]}", "Content-Type" to "application/json")
      val reply = try {
        post(url, headers, body)
      } catch (e: SocketTimeoutException) {
        // The post turns a connect timeout into a plain IOException, so this one is a read timeout: the model has the request and bills it, so never send it again.
        throw AiError(AiError.Kind.TIMEOUT, "The AI took too long to answer. Inflow will try again later.")
      } catch (e: IOException) {
        if (last) throw AiError(AiError.Kind.OFFLINE, "Inflow couldn't reach the model. Check the phone's connection and try again.")
        null
      }
      when {
        reply == null -> Unit
        reply.code in 200..299 -> return parse(reply.body).copy(inputChars = system.length + user.length)
        reply.code == 401 || reply.code == 403 -> throw AiError(
          AiError.Kind.AUTH,
          "The model refused ${if (keys.size > 1) "API key ${current + 1} of ${keys.size}" else "the API key"} (HTTP ${reply.code}). Check your API key in Settings.",
        )
        // A key at its limit hands over to the next one at once; Inflow only waits once every key is limited.
        reply.code == 429 && ++limited < keys.size -> {
          current = (current + 1) % keys.size
          continue
        }
        reply.code == 429 && last ->
          throw AiError(AiError.Kind.SERVER, "The model's rate limit was reached (HTTP 429). Wait a minute, or check your plan's limits.")
        reply.code >= 500 && last -> throw AiError(AiError.Kind.SERVER, "The model is busy or failing (HTTP ${reply.code}). Try again later.")
        reply.code == 429 || reply.code >= 500 -> Unit
        else -> throw AiError(
          AiError.Kind.BAD_REQUEST,
          "The model rejected the request (HTTP ${reply.code}): " + keys.fold(reply.body) { b, k -> b.replace(k, "[key]") }.take(2_000),
        )
      }
      sleep(reply?.retryAfterMs?.coerceIn(0, MAX_WAIT_MS) ?: RETRY_DELAYS[attempt])
      attempt++
      limited = 0
    }
  }

  private fun request(system: String, user: String, maxTokens: Int): String = buildJsonObject {
    put("model", model)
    put(
      "messages",
      JsonArray(
        listOf(
          buildJsonObject { put("role", "system"); put("content", system) },
          buildJsonObject { put("role", "user"); put("content", user) },
        ),
      ),
    )
    put("max_tokens", maxTokens)
    effort?.let { put("reasoning_effort", it) }
  }.toString()

  private fun parse(body: String): AiReply = try {
    val root = Json.parseToJsonElement(body).jsonObject
    val message = root["choices"]!!.jsonArray.first().jsonObject["message"]!!.jsonObject
    val usage = root["usage"] as? JsonObject
    fun count(o: JsonObject?, k: String) = (o?.get(k) as? JsonPrimitive)?.longOrNull ?: 0
    AiReply(
      (message["content"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
      Usage(count(usage, "prompt_tokens"), count(usage?.get("prompt_tokens_details") as? JsonObject, "cached_tokens"), count(usage, "completion_tokens")),
    )
  } catch (e: RuntimeException) {
    throw AiError(AiError.Kind.SERVER, "The model sent a reply Inflow couldn't read.")
  }

  private companion object {
    val RETRY_DELAYS = listOf(1_000L, 2_000L, 4_000L)
    const val MAX_WAIT_MS = 60_000L
    const val MAX_TOKENS = 8_000   // a batch of 40 items needs well under this; a runaway reply cannot cost more
  }
}

data class Prices(val inputPerM: Double, val cachedPerM: Double, val outputPerM: Double) {
  /** A provider that sends no usage (all zeros) is counted at about 4 characters per token, so the daily cap still holds. */
  fun cost(u: Usage, inputChars: Int = 0, outputChars: Int = 0): Double {
    val used = if (u.inputTokens == 0L && u.cachedTokens == 0L && u.outputTokens == 0L) Usage(inputChars / 4L, 0, outputChars / 4L) else u
    return ((used.inputTokens - used.cachedTokens).coerceAtLeast(0) * inputPerM + used.cachedTokens * cachedPerM + used.outputTokens * outputPerM) / 1_000_000
  }

  fun cost(r: AiReply): Double = cost(r.usage, r.inputChars, r.text.length)
}

/** A model Inflow knows: its prices and the thinking level that keeps a batch fast. */
data class KnownModel(val name: String, val baseUrl: String, val model: String, val prices: Prices, val effort: String?)

object AiModels {
  const val GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
  const val GROQ_URL = "https://api.groq.com/openai/v1/"

  // Google's pricing page and Groq's model cards, 2026-10-29 (as Deputy has them).
  val KNOWN = listOf(
    KnownModel("Gemini 3.5 Flash-Lite", GEMINI_URL, "gemini-3.5-flash-lite", Prices(0.30, 0.03, 2.50), null),
    KnownModel("GPT-OSS 120B on Groq", GROQ_URL, "openai/gpt-oss-120b", Prices(0.15, 0.075, 0.60), "low"),
    KnownModel("GPT-OSS 20B on Groq", GROQ_URL, "openai/gpt-oss-20b", Prices(0.075, 0.037, 0.30), "low"),
  )

  fun known(baseUrl: String, model: String) = KNOWN.firstOrNull { it.baseUrl.trimEnd('/') == baseUrl.trimEnd('/') && it.model == model }

  /** Deputy's validation copy; null when the address, model and prices can be saved. `customPrices` is null for a known model. */
  fun validate(baseUrl: String, model: String, customPrices: Prices?): String? {
    val url = baseUrl.trim()
    if (!(url.startsWith("https://") && runCatching { URI(url).host }.getOrNull() != null)) {
      return "The address must start with https://, so the key never travels unencrypted."
    }
    val name = model.trim()
    if (name.isEmpty() || name.length > 100 || name.any(Char::isWhitespace)) return "Type the model's name, with no spaces."
    if (customPrices == null) {
      return if (known(url, name) != null) null
      else "Enter this model's prices. Inflow only knows the prices of ${KNOWN.joinToString { it.name }}, and the cost limits are counted with them."
    }
    return price(customPrices.inputPerM, "input", 0.001) ?: price(customPrices.cachedPerM, "cached input", 0.0) ?: price(customPrices.outputPerM, "output", 0.001)
  }

  private fun price(v: Double, name: String, min: Double): String? =
    if (v.isFinite() && v in min..1000.0) null else "The $name price must be a number from ${plain(min)} to 1000."

  private fun plain(d: Double) = if (d % 1 == 0.0) d.toLong().toString() else d.toString()
}
