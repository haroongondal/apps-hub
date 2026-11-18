package expo.modules.notchisland.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

// The same allowed values as apps/notch/src/settings.ts; keep the two lists in step.
data class NotchSettings(
  val accent: String,
  val pill: String,
  val size: String,
  val corners: String,
  val foldMs: Int,
  val clock: String,
  val widgets: List<String>,
) {
  fun toJson(): String = JsonObject(
    mapOf(
      "accent" to JsonPrimitive(accent),
      "pill" to JsonPrimitive(pill),
      "size" to JsonPrimitive(size),
      "corners" to JsonPrimitive(corners),
      "foldMs" to JsonPrimitive(foldMs),
      "clock" to JsonPrimitive(clock),
      "widgets" to JsonArray(widgets.map { JsonPrimitive(it) }),
    ),
  ).toString()

  companion object {
    val DEFAULTS = NotchSettings(
      accent = "indigo",
      pill = "black",
      size = "regular",
      corners = "pill",
      foldMs = 5000,
      clock = "system",
      widgets = listOf("clock", "battery"),
    )

    private val ACCENTS = setOf("indigo", "cyan", "mint", "amber", "rose", "violet", "sky", "lime")
    private val PILLS = setOf("black", "graphite", "tinted")
    private val SIZES = setOf("compact", "regular", "large")
    private val CORNERS = setOf("pill", "rounded", "squared")
    private val FOLDS = setOf(3000, 5000, 10000, 0)
    private val CLOCKS = setOf("12", "24", "system")
    private val WIDGETS = setOf("clock", "battery", "timer", "media")

    /** Never throws: a null, blank or broken value gives the defaults, and each bad field falls back on its own. */
    fun parse(json: String?): NotchSettings {
      val o = runCatching { json?.takeIf { it.isNotBlank() }?.let { Json.parseToJsonElement(it) as? JsonObject } }
        .getOrNull() ?: return DEFAULTS
      fun str(key: String, allowed: Set<String>, fallback: String): String =
        (o[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.takeIf { it in allowed } ?: fallback
      val widgets = (o["widgets"] as? JsonArray)
        ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
        ?.filter { it in WIDGETS }
        ?.distinct()
        ?: DEFAULTS.widgets
      return NotchSettings(
        accent = str("accent", ACCENTS, DEFAULTS.accent),
        pill = str("pill", PILLS, DEFAULTS.pill),
        size = str("size", SIZES, DEFAULTS.size),
        corners = str("corners", CORNERS, DEFAULTS.corners),
        foldMs = (o["foldMs"] as? JsonPrimitive)?.intOrNull?.takeIf { it in FOLDS } ?: DEFAULTS.foldMs,
        clock = str("clock", CLOCKS, DEFAULTS.clock),
        widgets = widgets,
      )
    }
  }
}
