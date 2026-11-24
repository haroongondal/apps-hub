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

/** The plain words every screen shows when AI hub is not ready. The TypeScript twin is src/aiHub.ts; fixtures/ai-hub-copy.json holds both and a test in each language reads it. */
object HubCopy {
  const val MISSING = "AI needs AI hub."
  const val NOT_ALLOWED = "Allow Inflow in AI hub."
  const val VERSION = "AI needs a newer AI hub."
  const val NO_KEY = "Add a key in AI hub."
  const val BUSY = "AI hub is busy. Inflow will try again later."
  const val REFUSED = "AI hub couldn't take that request. Try fewer days or a shorter question."
  const val FAILED = "AI hub couldn't finish the request. Inflow will try again later."
  const val TIMEOUT = "The AI took too long to answer. Inflow will try again later."
  const val UNREADABLE = "AI hub sent a reply Inflow couldn't read. Update AI hub or Inflow."
}

/**
 * Inflow's only AI: one chat request to AI hub, no key of its own and no fallback. The prompt is already R44-filtered by the caller; health text
 * reaches here only from the Doctor summary tap and from Ask with its switch on (the Ask run and the Doctor summary), never from a background batch.
 * [answered] runs after every reply the hub gave and Inflow could read: the one moment the keys Inflow saved before the hub-only change may be deleted.
 */
class HubAi(
  private val hub: (String) -> String,
  private val foreground: Boolean,
  private val answered: () -> Unit,
  private val ids: () -> String,
) : TextAi {
  override fun complete(system: String, user: String, maxTokens: Int): AiReply {
    val json = HubChat.request(ids(), foreground, system, user, maxTokens)
    val raw = try {
      hub(json)
    } catch (e: AiHubException) {
      throw HubChat.asAiError(e)
    }
    // The hub already billed the call, so an unreadable reply is an error, never a second request.
    return HubChat.parse(raw, system.length + user.length).also { runCatching(answered) }   // the cleanup is best effort: it runs again at the next start
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

  fun parse(json: String, inputChars: Int): AiReply = try {
    val o = Json.parseToJsonElement(json) as JsonObject
    val model = (o["model"] as JsonPrimitive).also { require(it.isString) }.content
    val usage = o["usage"] as? JsonObject
    fun count(k: String) = (usage?.get(k) as? JsonPrimitive)?.longOrNull ?: 0
    AiReply(
      (o["text"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull.orEmpty(),
      Usage(count("inputTokens"), count("cachedTokens"), count("outputTokens")),
      inputChars,
      model = model,
    )
  } catch (e: RuntimeException) {
    throw AiError(AiError.Kind.SERVER, HubCopy.UNREADABLE)
  }

  fun asAiError(e: AiHubException): AiError = when (e.kind) {
    Kinds.HUB_MISSING -> AiError(AiError.Kind.HUB_MISSING, HubCopy.MISSING)
    Kinds.NOT_ALLOWED -> AiError(AiError.Kind.NOT_ALLOWED, HubCopy.NOT_ALLOWED)
    Kinds.VERSION -> AiError(AiError.Kind.VERSION, HubCopy.VERSION)
    Kinds.NO_KEY -> AiError(AiError.Kind.NO_KEY, HubCopy.NO_KEY)
    Kinds.TOO_LARGE, Kinds.INVALID -> AiError(AiError.Kind.BAD_REQUEST, HubCopy.REFUSED)
    Kinds.BUSY -> AiError(AiError.Kind.SERVER, HubCopy.BUSY)
    Kinds.TIMEOUT -> AiError(AiError.Kind.TIMEOUT, HubCopy.TIMEOUT)
    else -> AiError(AiError.Kind.SERVER, HubCopy.FAILED)   // provider-error and cancelled: no hub error text ever reaches the screen
  }
}
