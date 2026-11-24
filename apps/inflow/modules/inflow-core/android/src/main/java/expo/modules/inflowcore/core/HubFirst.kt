package expo.modules.inflowcore.core

import expo.modules.aihubclient.core.AiHubException
import expo.modules.aihubclient.core.Kinds
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

interface TextAi {
  fun complete(system: String, user: String, maxTokens: Int = DEFAULT_MAX_TOKENS): AiReply

  companion object {
    const val DEFAULT_MAX_TOKENS = 8_000
  }
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

// E2: the prompt is already R44-filtered; health data never reaches this class (Doctor summary and health-on Ask use the own key only, HubRoutingTest).
class HubFirst(
  private val hub: (String) -> String,
  private val own: TextAi,
  private val pause: HubPause,
  private val foreground: Boolean,
  private val record: (String) -> Unit,
  private val ids: () -> String,
) : TextAi {
  @Volatile private var hubOff = false

  override fun complete(system: String, user: String, maxTokens: Int): AiReply {
    if (!hubOff && !pause.paused()) {
      val reply = try {
        HubChat.parse(hub(HubChat.request(ids(), foreground, system, user, maxTokens)), system.length + user.length)
      } catch (e: AiHubException) {
        if (e.kind !in FALL_BACK) throw HubChat.asAiError(e)
        if (e.kind == Kinds.NOT_ALLOWED) pause.pause()
        hubOff = true
        null
      }
      if (reply != null) return reply.also { record(HUB) }
    }
    return own.complete(system, user, maxTokens).also { record(OWN) }
  }

  companion object {
    const val HUB = "hub"
    const val OWN = "own"
    val FALL_BACK = setOf(Kinds.HUB_MISSING, Kinds.NOT_ALLOWED, Kinds.VERSION, Kinds.NO_KEY, Kinds.TOO_LARGE)
  }
}

object HubChat {
  const val MAX_TOKENS = 8_192

  fun request(id: String, foreground: Boolean, system: String, user: String, maxTokens: Int): String = buildJsonObject {
    put("apiVersion", 1)
    put("requestId", id)
    put("job", "chat")
    put("priority", if (foreground) "foreground" else "background")
    put(
      "messages",
      JsonArray(
        listOf(
          buildJsonObject { put("role", "system"); put("content", system) },
          buildJsonObject { put("role", "user"); put("content", user) },
        ),
      ),
    )
    put("maxTokens", maxTokens.coerceIn(1, MAX_TOKENS))
  }.toString()

  // The hub already billed the call, so an unreadable reply is an error, never a second request to the own key.
  fun parse(json: String, inputChars: Int): AiReply = try {
    val o = Json.parseToJsonElement(json) as JsonObject
    val model = (o["model"] as JsonPrimitive).also { require(it.isString) }.content
    val usage = o["usage"] as? JsonObject
    fun count(k: String) = (usage?.get(k) as? JsonPrimitive)?.longOrNull ?: 0
    AiReply(
      (o["text"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull.orEmpty(),
      Usage(count("inputTokens"), count("cachedTokens"), count("outputTokens")),
      inputChars,
      hubModel = model,
    )
  } catch (e: RuntimeException) {
    throw AiError(AiError.Kind.SERVER, "AI hub sent a reply Inflow couldn't read. Update AI hub or Inflow.")
  }

  fun asAiError(e: AiHubException): AiError =
    if (e.kind == Kinds.TIMEOUT) AiError(AiError.Kind.TIMEOUT, OpenAiCompatProvider.TIMEOUT_COPY)
    else AiError(AiError.Kind.SERVER, e.message ?: "AI hub couldn't finish the request. Inflow will try again later.")
}
