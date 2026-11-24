package expo.modules.aihubclient.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

class AiHubException(val kind: String, message: String) : Exception(message)

object Kinds {
  const val HUB_MISSING = "hub-missing"
  const val NOT_ALLOWED = "not-allowed"
  const val VERSION = "version"
  const val NO_KEY = "no-key"
  const val TOO_LARGE = "too-large"
  const val INVALID = "invalid"
  const val BUSY = "busy"
  const val CANCELLED = "cancelled"
  const val TIMEOUT = "timeout"
  const val PROVIDER = "provider-error"

  // The hub's onError kinds (Worker and AiError.Kind, lowercased). "auth" means the hub has no working key, so the app's own key may still help.
  fun fromHub(kind: String?): String = when (kind) {
    "denied" -> NOT_ALLOWED
    "auth" -> NO_KEY
    "too_large" -> TOO_LARGE
    "invalid" -> INVALID
    "busy", "rate" -> BUSY
    "cancelled" -> CANCELLED
    "timeout" -> TIMEOUT
    else -> PROVIDER
  }
}

data class Checked(val requestId: String, val apiVersion: Int, val job: String)

object HubLimits {
  const val MAX_JSON_BYTES = 512 * 1024
  const val MAX_TEXTS = 8
  const val MAX_IMAGE_BYTES = 7L * 1024 * 1024
  const val MAX_AUDIO_BYTES = 25L * 1024 * 1024

  private val ID = Regex("[A-Za-z0-9_-]{1,64}")
  private val JOBS = setOf("chat", "vision", "embed", "transcribe")

  fun requestIdOf(json: String): String? = rootOf(json)?.text("requestId")?.takeIf { ID.matches(it) }

  // `attachmentSize` is null when nothing is attached and -1 when the attachment is not a regular file.
  fun check(json: String, attachmentSize: Long?): Checked {
    if (json.toByteArray(Charsets.UTF_8).size > MAX_JSON_BYTES) {
      throw AiHubException(Kinds.TOO_LARGE, "The request is over 512 KB. Send images and audio as the attachment.")
    }
    val root = rootOf(json) ?: throw AiHubException(Kinds.INVALID, "The request isn't a JSON object.")
    val id = root.text("requestId")?.takeIf { ID.matches(it) }
      ?: throw AiHubException(Kinds.INVALID, "The requestId must be 1 to 64 letters, digits, - or _.")
    val version = (root["apiVersion"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull?.takeIf { it >= 1 }
      ?: throw AiHubException(Kinds.INVALID, "The request has no apiVersion.")
    val job = root.text("job")?.takeIf { it in JOBS } ?: throw AiHubException(Kinds.INVALID, "The job must be chat, vision, embed or transcribe.")
    if (job == "embed" && ((root["texts"] as? JsonArray)?.size ?: 0) > MAX_TEXTS) {
      throw AiHubException(Kinds.TOO_LARGE, "AI hub takes at most $MAX_TEXTS texts at a time. Split them into smaller batches.")
    }
    val cap = when (job) {
      "vision" -> MAX_IMAGE_BYTES
      "transcribe" -> MAX_AUDIO_BYTES
      else -> null
    }
    val what = if (job == "vision") "picture" else "audio file"
    when {
      cap == null && attachmentSize != null -> throw AiHubException(Kinds.INVALID, "A $job request takes no attachment.")
      cap == null -> Unit
      attachmentSize == null -> throw AiHubException(Kinds.INVALID, "Attach the $what to the request.")
      attachmentSize < 0 -> throw AiHubException(Kinds.INVALID, "Send the $what as a file on the phone.")
      attachmentSize > cap -> throw AiHubException(Kinds.TOO_LARGE, "The $what is over ${cap / (1024 * 1024)} MB. Send a smaller one.")
    }
    return Checked(id, version, job)
  }

  private fun rootOf(json: String): JsonObject? = try {
    Json.parseToJsonElement(json) as? JsonObject
  } catch (e: Exception) {
    null
  }

  private fun JsonObject.text(key: String): String? = (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content
}
