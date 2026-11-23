package expo.modules.aihubcore.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

data class UsageCount(
  val calls: Long = 0,
  val inputTokens: Long = 0,
  val outputTokens: Long = 0,
  val lastUsedMs: Long = 0,
)

// Counts only: request and reply text is never stored.
data class Usage(val apps: Map<String, Map<String, UsageCount>> = emptyMap()) {
  fun record(pkg: String, service: String, inputTokens: Long, outputTokens: Long, now: Long): Usage {
    val byService = apps[pkg].orEmpty()
    val old = byService[service] ?: UsageCount()
    val next = UsageCount(old.calls + 1, old.inputTokens + inputTokens, old.outputTokens + outputTokens, now)
    return Usage(apps + (pkg to (byService + (service to next))))
  }

  fun toJson(): String = buildJsonObject {
    put("apps", buildJsonObject {
      apps.forEach { (pkg, services) ->
        put(pkg, buildJsonObject {
          services.forEach { (service, c) ->
            put(service, buildJsonObject {
              put("calls", c.calls)
              put("inputTokens", c.inputTokens)
              put("outputTokens", c.outputTokens)
              put("lastUsedMs", c.lastUsedMs)
            })
          }
        })
      }
    })
  }.toString()

  companion object {
    fun fromJson(text: String?): Usage = try {
      val root = Json.parseToJsonElement(text ?: "").jsonObject["apps"]?.jsonObject
      Usage(root.orEmpty().mapValues { (_, services) ->
        services.jsonObject.mapValues { (_, c) -> count(c.jsonObject) }
      })
    } catch (e: Exception) {
      Usage()
    }

    private fun count(o: JsonObject) = UsageCount(
      o.long("calls"), o.long("inputTokens"), o.long("outputTokens"), o.long("lastUsedMs"),
    )

    private fun JsonObject.long(key: String): Long = (get(key) as? JsonPrimitive)?.long ?: 0L
  }
}
