package expo.modules.deputyagent.core

import expo.modules.aihubclient.core.AiHubException
import expo.modules.aihubclient.core.Kinds
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

fun interface HubCall {
  suspend fun submit(requestJson: String, jpegBase64: String?): String
}

class HubPause(private val now: () -> Long) {
  @Volatile private var until = 0L

  fun paused(): Boolean = now() < until

  fun pause() {
    until = now() + MS
  }

  companion object {
    const val MS = 10 * 60_000L
  }
}

/** AI hub first, the own key second; a run stays on one service (Groq refuses Gemini's signatures), so the own key takes over only before the hub has answered once. */
class HubFirst(
  private val hub: HubCall,
  private val own: LlmProvider,
  private val pause: HubPause,
  private val record: (String) -> Unit,
  private val ids: () -> String,
) : LlmProvider {
  private var hubOff = false
  private var served = false

  override suspend fun step(history: List<Msg>, tools: List<ToolSpec>): ModelTurn {
    if (!hubOff && !pause.paused()) {
      try {
        return viaHub(history, tools).also {
          served = true
          record(HUB)
        }
      } catch (e: AiHubException) {
        if (served || e.kind !in FALL_BACK) throw HubChat.asProviderError(e)
        if (e.kind == Kinds.NOT_ALLOWED) pause.pause()
        hubOff = true
      }
    }
    return own.step(history, tools).also { record(OWN) }
  }

  private suspend fun viaHub(history: List<Msg>, tools: List<ToolSpec>): ModelTurn {
    val (messages, shot) = HubChat.split(history)
    var attempt = 0
    while (true) {
      try {
        return HubChat.parse(hub.submit(HubChat.request(ids(), messages, tools, shot?.mime), shot?.base64))
      } catch (e: AiHubException) {
        val waits = when (e.kind) {
          Kinds.BUSY -> RATE_DELAYS
          Kinds.PROVIDER -> RETRY_DELAYS
          else -> throw e
        }
        if (attempt == waits.size) throw e
        delay(waits[attempt++])
      }
    }
  }

  companion object {
    const val HUB = "hub"
    const val OWN = "own"
    val FALL_BACK = setOf(Kinds.HUB_MISSING, Kinds.NOT_ALLOWED, Kinds.VERSION, Kinds.NO_KEY, Kinds.TOO_LARGE)
    val RETRY_DELAYS = listOf(1_000L, 2_000L, 4_000L)
    val RATE_DELAYS = listOf(10_000L, 20_000L, 30_000L)
  }
}

object HubChat {
  const val API_VERSION = 3
  const val MAX_TOKENS = 4_096

  class Shot(val mime: String, val base64: String)

  /** The latest screenshot leaves the message and rides as the picture file: inline it would count against the 512 KB limit and cross Binder as UTF-16. */
  fun split(history: List<Msg>): Pair<List<JsonObject>, Shot?> {
    val last = history.lastOrNull()?.takeIf { it.role == "user" }
    val parts = last?.json?.get("content") as? JsonArray
    val image = parts?.firstOrNull { (it as? JsonObject)?.get("type")?.jsonPrimitive?.contentOrNull == "image_url" } as? JsonObject
    val url = (image?.get("image_url") as? JsonObject)?.get("url")?.jsonPrimitive?.contentOrNull
    val cut = url?.indexOf(BASE64) ?: -1
    val shot = if (url != null && url.startsWith("data:image/") && cut > 0) Shot(url.substring(5, cut), url.substring(cut + BASE64.length)) else null
    if (last == null || parts == null || shot == null) return history.map { it.json } to null
    val kept = JsonArray(parts.filter { it !== image })
    return history.dropLast(1).map { it.json }.plus(JsonObject(last.json + ("content" to kept))) to shot
  }

  fun request(id: String, messages: List<JsonObject>, tools: List<ToolSpec>, mime: String?): String = buildJsonObject {
    put("apiVersion", API_VERSION)
    put("requestId", id)
    put("job", if (mime == null) "chat" else "vision")
    put("priority", "foreground")
    put("messages", JsonArray(messages))
    if (tools.isNotEmpty()) {
      put("tools", JsonArray(tools.map { t -> buildJsonObject { put("name", t.name); put("description", t.description); put("parameters", t.parameters) } }))
      put("toolChoice", "required")
    }
    put("maxTokens", MAX_TOKENS)
    put("service", "gemini")
    mime?.let { put("mime", it) }
  }.toString()

  fun parse(json: String): ModelTurn = try {
    val o = Json.parseToJsonElement(json).jsonObject
    val raw = o["raw"] as JsonObject
    require(raw["role"]?.jsonPrimitive?.contentOrNull == "assistant")
    val calls = (o["toolCalls"] as? JsonArray).orEmpty().map { c ->
      val co = c.jsonObject
      ToolCall(co["id"]?.jsonPrimitive?.contentOrNull.orEmpty(), co["name"]!!.jsonPrimitive.content.substringAfterLast('.'), co["args"] as? JsonObject ?: JsonObject(emptyMap()))
    }
    val usage = o["usage"] as? JsonObject
    fun count(k: String) = (usage?.get(k) as? JsonPrimitive)?.longOrNull ?: 0
    ModelTurn(
      raw = Msg("assistant", raw),
      toolCalls = calls,
      usage = Usage(count("inputTokens"), count("cachedTokens"), count("outputTokens")),
      text = (o["text"] as? JsonPrimitive)?.contentOrNull,
      hubModel = o["model"]!!.jsonPrimitive.content,
    )
  } catch (e: RuntimeException) {
    throw ProviderError(ProviderError.Kind.SERVER, "AI hub sent a reply Deputy couldn't read. Update AI hub or Deputy.")
  }

  fun asProviderError(e: AiHubException): ProviderError {
    val kind = when (e.kind) {
      Kinds.NOT_ALLOWED, Kinds.NO_KEY -> ProviderError.Kind.AUTH
      Kinds.INVALID, Kinds.TOO_LARGE, Kinds.VERSION -> ProviderError.Kind.BAD_REQUEST
      else -> ProviderError.Kind.SERVER
    }
    return ProviderError(kind, e.message?.takeIf { it.isNotBlank() } ?: "AI hub couldn't finish the step. Try again.")
  }

  private const val BASE64 = ";base64,"
}
