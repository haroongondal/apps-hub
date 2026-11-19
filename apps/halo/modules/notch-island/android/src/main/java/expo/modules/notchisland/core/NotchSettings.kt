package expo.modules.notchisland.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

data class EventSwitches(val charging: Boolean = true, val ringer: Boolean = true, val dnd: Boolean = true, val bluetooth: Boolean = true)

// The same allowed values as apps/halo/src/island/settings.ts; keep the two lists in step.
data class NotchSettings(
  val accent: String,
  val pill: String,
  val size: String,
  val corners: String,
  val foldMs: Int,
  val clock: String,
  val widgets: List<String>,
  val events: EventSwitches = EventSwitches(),
  val progressCards: Boolean = true,
  val messagePeek: MessagePeekSettings = MessagePeekSettings(),
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
      "events" to JsonObject(mapOf("charging" to JsonPrimitive(events.charging), "ringer" to JsonPrimitive(events.ringer), "dnd" to JsonPrimitive(events.dnd), "bluetooth" to JsonPrimitive(events.bluetooth))),
      "progressCards" to JsonPrimitive(progressCards),
      "messagePeek" to JsonObject(mapOf("on" to JsonPrimitive(messagePeek.on), "apps" to JsonArray(messagePeek.apps.map { JsonPrimitive(it) }))),
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

    // The same colours as SWATCHES in apps/halo/src/island/settings.ts.
    val SWATCHES = mapOf(
      "indigo" to "#818CF8", "cyan" to "#22D3EE", "mint" to "#34D399", "amber" to "#FBBF24",
      "rose" to "#FB7185", "violet" to "#C084FC", "sky" to "#38BDF8", "lime" to "#A3E635",
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
      val e = o["events"] as? JsonObject
      val peek = o["messagePeek"] as? JsonObject
      fun flag(key: String, fallback: Boolean): Boolean =
        (e?.get(key) as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: fallback
      return NotchSettings(
        accent = str("accent", ACCENTS, DEFAULTS.accent),
        pill = str("pill", PILLS, DEFAULTS.pill),
        size = str("size", SIZES, DEFAULTS.size),
        corners = str("corners", CORNERS, DEFAULTS.corners),
        foldMs = (o["foldMs"] as? JsonPrimitive)?.intOrNull?.takeIf { it in FOLDS } ?: DEFAULTS.foldMs,
        clock = str("clock", CLOCKS, DEFAULTS.clock),
        widgets = widgets,
        events = EventSwitches(
          charging = flag("charging", DEFAULTS.events.charging),
          ringer = flag("ringer", DEFAULTS.events.ringer),
          dnd = flag("dnd", DEFAULTS.events.dnd),
          bluetooth = flag("bluetooth", DEFAULTS.events.bluetooth),
        ),
        progressCards = (o["progressCards"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: DEFAULTS.progressCards,
        messagePeek = MessagePeekSettings(
          on = (peek?.get("on") as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: DEFAULTS.messagePeek.on,
          apps = (peek?.get("apps") as? JsonArray)
            ?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content?.takeIf(MessagePeek.PACKAGE::matches) }
            ?.distinct()
            ?.take(MessagePeek.MAX_APPS)
            ?: DEFAULTS.messagePeek.apps,
        ),
      )
    }
  }
}
