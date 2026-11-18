package expo.modules.inflowcore.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

data class MoneySurpriseConfig(val multiple: Int = 3, val minMinor: Long = 500_000, val hugeMinor: Long = 5_000_000)

/** Stored as JSON in `ItemStore.meta("autopilotSettings")`. */
data class AutopilotSettings(
  val kinds: Set<SuggestionKind> = SuggestionKind.values().toSet(),
  val surprise: MoneySurpriseConfig = MoneySurpriseConfig(),
  val pickedChats: Set<String> = emptySet(),
  val lookIn: Set<String> = emptySet(),
  val bankApp: String? = null,
  val alarmBefore: Boolean = false,
) {
  fun toJson(): String = buildJsonObject {
    put("kinds", JsonArray(kinds.map { JsonPrimitive(it.name) }))
    put("multiple", surprise.multiple)
    put("minMinor", surprise.minMinor)
    put("hugeMinor", surprise.hugeMinor)
    put("pickedChats", JsonArray(pickedChats.map(::JsonPrimitive)))
    put("lookIn", JsonArray(lookIn.map(::JsonPrimitive)))
    put("bankApp", bankApp?.let(::JsonPrimitive) ?: JsonNull)
    put("alarmBefore", alarmBefore)
  }.toString()

  companion object {
    /** Bad JSON, or a field of the wrong type, gives that field's default. */
    fun fromJson(json: String?): AutopilotSettings {
      val d = AutopilotSettings()
      val o = runCatching { Json.parseToJsonElement(json ?: return d).jsonObject }.getOrNull() ?: return d
      val dc = d.surprise
      return AutopilotSettings(
        kinds = o.strings("kinds")?.mapNotNull { n -> SuggestionKind.values().firstOrNull { it.name == n } }?.toSet() ?: d.kinds,
        surprise = MoneySurpriseConfig(
          multiple = o.long("multiple")?.takeIf { it in 1..1000 }?.toInt() ?: dc.multiple,
          minMinor = o.long("minMinor")?.takeIf { it >= 0 } ?: dc.minMinor,
          hugeMinor = o.long("hugeMinor")?.takeIf { it >= 0 } ?: dc.hugeMinor,
        ),
        pickedChats = o.strings("pickedChats")?.toSet() ?: d.pickedChats,
        lookIn = o.strings("lookIn")?.toSet() ?: d.lookIn,
        bankApp = (o["bankApp"] as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.contentOrNull,
        alarmBefore = (o["alarmBefore"] as? JsonPrimitive)?.booleanOrNull ?: d.alarmBefore,
      )
    }

    private fun JsonObject.long(k: String): Long? = (this[k] as? JsonPrimitive)?.longOrNull

    private fun JsonObject.strings(k: String): List<String>? =
      (this[k] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
  }
}
