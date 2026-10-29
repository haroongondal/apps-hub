package expo.modules.deputyagent.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** FR-9: a name, the task text and the apps it may use. No apps listed means any app the trust table allows. */
data class SavedTask(val id: String, val name: String, val task: String, val apps: List<String>) {
  init {
    require(name.isNotBlank() && name.length <= 60) { "Give the task a name of up to 60 characters." }
    require(task.isNotBlank()) { "Type what the task should do." }
  }

  companion object {
    /** The run's allowed apps: none listed means no limit. */
    fun allowList(apps: List<String>?): Set<String>? = apps?.toSet()?.ifEmpty { null }

    fun toJson(tasks: List<SavedTask>): String = JsonArray(
      tasks.map { t ->
        buildJsonObject { put("id", t.id); put("name", t.name); put("task", t.task); put("apps", JsonArray(t.apps.map(::JsonPrimitive))) }
      },
    ).toString()

    /** Skips entries that no longer validate, so one bad entry can't hide the rest. */
    fun fromJson(json: String): List<SavedTask> = runCatching { Json.parseToJsonElement(json).jsonArray }.getOrNull().orEmpty().mapNotNull { e ->
      runCatching {
        val o = e.jsonObject
        SavedTask(o["id"]!!.jsonPrimitive.content, o["name"]!!.jsonPrimitive.content, o["task"]!!.jsonPrimitive.content, o["apps"]!!.jsonArray.map { it.jsonPrimitive.content })
      }.getOrNull()
    }
  }
}
