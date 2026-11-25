package expo.modules.aihubcore.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

data class PendingApp(val pkg: String, val lastMs: Long)

object PendingApps {
  const val CAP = 20
  const val QUIET_MS = 60_000L

  fun parse(json: String?): List<PendingApp> = rows(json, "apps").mapNotNull { o ->
    val pkg = o.text("pkg") ?: return@mapNotNull null
    PendingApp(pkg, o.num("lastMs") ?: 0)
  }

  // Null when the package already asked within QUIET_MS, so a caller that keeps asking does not cause a write on every call.
  fun record(list: List<PendingApp>, pkg: String, now: Long): List<PendingApp>? {
    val old = list.firstOrNull { it.pkg == pkg }
    if (old != null && now - old.lastMs in 0 until QUIET_MS) return null
    return (listOf(PendingApp(pkg, now)) + list.filter { it.pkg != pkg }).take(CAP)
  }

  fun remove(list: List<PendingApp>, pkg: String): List<PendingApp> = list.filter { it.pkg != pkg }

  fun toJson(list: List<PendingApp>): String = buildJsonObject {
    put("apps", JsonArray(list.map { p -> buildJsonObject { put("pkg", p.pkg); put("lastMs", p.lastMs) } }))
  }.toString()
}

// Never the prompt, the reply or a key: only who asked, for what, through which service and when. A failed request also holds the error kind,
// the provider's HTTP status and whether the other service was tried, never the provider's error text (it can echo the request).
data class LoggedCall(
  val pkg: String,
  val job: String,
  val service: String,
  val timeMs: Long,
  val error: String? = null,
  val httpCode: Int? = null,
  val fellBack: Boolean = false,
  val detail: String? = null,
)

object CallLog {
  const val CAP = 200

  fun parse(json: String?): List<LoggedCall> = rows(json, "calls").mapNotNull { o ->
    LoggedCall(
      o.text("pkg") ?: return@mapNotNull null,
      o.text("job") ?: return@mapNotNull null,
      o.text("service") ?: return@mapNotNull null,
      o.num("timeMs") ?: 0,
      o.text("error"),
      o.num("code")?.toInt(),
      (o["fellBack"] as? JsonPrimitive)?.booleanOrNull == true,
      o.text("detail"),
    )
  }

  fun add(list: List<LoggedCall>, call: LoggedCall): List<LoggedCall> = (listOf(call) + list).take(CAP)

  fun toJson(list: List<LoggedCall>): String = buildJsonObject {
    put(
      "calls",
      JsonArray(
        list.map { c ->
          buildJsonObject {
            put("pkg", c.pkg); put("job", c.job); put("service", c.service); put("timeMs", c.timeMs)
            c.error?.let { put("error", it) }
            c.httpCode?.let { put("code", it) }
            if (c.fellBack) put("fellBack", true)
            c.detail?.let { put("detail", it) }
          }
        },
      ),
    )
  }.toString()
}

private fun rows(json: String?, key: String): List<JsonObject> = try {
  (Json.parseToJsonElement(json ?: "").jsonObject[key] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
} catch (e: Exception) {
  emptyList()
}

private fun JsonObject.text(key: String): String? = (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotEmpty() }

private fun JsonObject.num(key: String): Long? = (get(key) as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull
