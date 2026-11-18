package expo.modules.inflowcore.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** What the JS side sees of the Autopilot module functions: plain maps, so Expo can carry them. Keys equal packages/autopilot-contract SuggestionRow. */
fun Suggestion.toRow(): Map<String, Any?> = mapOf(
  "id" to id, "kind" to kind.name.lowercase(), "title" to title, "item_id" to itemId, "due_at" to dueAt,
  "state" to state.name.lowercase(), "created_at" to createdAt, "expires_at" to expiresAt,
)

/** Same keys as [AutopilotSettings.toJson]; kinds are lowercase like the contract's Kind, lists are sorted so a save without a change is the same list. */
fun AutopilotSettings.toMap(): Map<String, Any?> = mapOf(
  "kinds" to SuggestionKind.values().filter { it in kinds }.map { it.name.lowercase() },
  "multiple" to surprise.multiple, "minMinor" to surprise.minMinor, "hugeMinor" to surprise.hugeMinor,
  "pickedChats" to pickedChats.sorted(), "lookIn" to lookIn.sorted(), "bankApp" to bankApp, "alarmBefore" to alarmBefore,
)

object AutopilotSettingsInput {
  /**
   * What JS sent, checked: a bad field falls back to its default ([AutopilotSettings.fromJson]), kinds are matched in any case, and a picked
   * chat without the "|" of [pickedChatKey] is dropped (it could never match a conversation), as is one in a [AutopilotAccess.NEVER_SHARE] app.
   */
  fun fromMap(m: Map<String, Any?>): AutopilotSettings {
    val fixed = m.mapValues { (k, v) -> if (k == "kinds" && v is Iterable<*>) v.map { (it as? String)?.uppercase() ?: it } else v }
    val s = AutopilotSettings.fromJson(element(fixed).toString())
    return s.copy(pickedChats = s.pickedChats.filter { '|' in it && it.substringBefore('|') !in AutopilotAccess.NEVER_SHARE }.toSet())
  }

  // A JS number reaches Kotlin as a Double: 5000000.0 has no Long form in JSON text, so a whole number is passed on as a Long.
  private fun element(v: Any?): JsonElement = when (v) {
    null -> JsonNull
    is Boolean -> JsonPrimitive(v)
    is String -> JsonPrimitive(v)
    is Number -> if (v.toDouble().isFinite()) JsonPrimitive(if (v.toDouble() % 1.0 == 0.0 && Math.abs(v.toDouble()) < 9e15) v.toLong() else v) else JsonNull
    is Map<*, *> -> JsonObject(v.entries.associate { (k, x) -> k.toString() to element(x) })
    is Iterable<*> -> JsonArray(v.map(::element))
    is Array<*> -> JsonArray(v.map(::element))
    else -> JsonNull
  }
}
