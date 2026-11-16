package expo.modules.haloengine.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import kotlin.math.roundToInt

enum class ColorSource(val key: String) { PALETTE("palette"), ALBUM_ART("albumArt"), WALLPAPER("wallpaper") }

data class SettingsParams(
  val thickness: Double = 4.0,
  val speed: Double = 0.5,
  val spread: Double = 0.5,
  val glow: Double = 0.6,
  val padding: Double = 0.0,
  val roundness: Double = 1.0,
  val mirrored: Boolean = false,
  val clockwise: Boolean = true,
)

data class SettingsColors(
  val source: ColorSource = ColorSource.ALBUM_ART,
  val palette: List<String> = listOf("#22D3EE", "#A78BFA"),
)

// corners are px tl,tr,br,bl; insets are px l,t,r,b.
data class SettingsEdges(
  val auto: Boolean = true,
  val corners: List<Int> = listOf(0, 0, 0, 0),
  val insets: List<Int> = listOf(0, 0, 0, 0),
)

data class Settings(
  val enabled: Boolean = true,
  val pattern: String = "pulse-ring",
  val params: SettingsParams = SettingsParams(),
  val colors: SettingsColors = SettingsColors(),
  val edges: SettingsEdges = SettingsEdges(),
)

/** Mirrors apps/halo/modules/halo-engine/src/settings.ts; both run fixtures/settings.cases.json. */
object SettingsCodec {
  private val HEX = Regex("^#[0-9a-fA-F]{6}$")
  private val ID = Regex("^[a-z0-9-]{1,40}$")
  private val D = Settings()

  /** Any input becomes a valid Settings: wrong types fall back, numbers clamp, unknown fields drop. Never throws. */
  fun decode(json: String): Settings {
    val root = (runCatching { Json.parseToJsonElement(json) }.getOrNull() as? JsonObject) ?: JsonObject(emptyMap())
    val p = root.obj("params")
    val c = root.obj("colors")
    val e = root.obj("edges")
    val palette = (c["palette"] as? JsonArray).orEmpty()
      .mapNotNull { (it as? JsonPrimitive)?.takeIf { s -> s.isString }?.content }
      .filter { HEX.matches(it) }
      .take(4)
      .map { it.uppercase() }
    return Settings(
      enabled = root.bool("enabled", D.enabled),
      // An unregistered but well-formed id is kept; Patterns.create falls back to pulse-ring.
      pattern = root.str("pattern")?.takeIf { ID.matches(it) } ?: D.pattern,
      params = SettingsParams(
        thickness = p.num("thickness", D.params.thickness, 1.0, 24.0),
        speed = p.num("speed", D.params.speed, 0.0, 1.0),
        spread = p.num("spread", D.params.spread, 0.0, 1.0),
        glow = p.num("glow", D.params.glow, 0.0, 1.0),
        padding = p.num("padding", D.params.padding, 0.0, 32.0),
        roundness = p.num("roundness", D.params.roundness, 0.0, 1.5),
        mirrored = p.bool("mirrored", D.params.mirrored),
        clockwise = p.bool("clockwise", D.params.clockwise),
      ),
      colors = SettingsColors(
        source = ColorSource.entries.firstOrNull { it.key == c.str("source") } ?: D.colors.source,
        palette = palette.ifEmpty { D.colors.palette },
      ),
      edges = SettingsEdges(
        auto = e.bool("auto", D.edges.auto),
        corners = e.quad("corners", 400.0),
        insets = e.quad("insets", 200.0),
      ),
    )
  }

  fun encode(s: Settings): String = buildJsonObject {
    put("version", 1)
    put("enabled", s.enabled)
    put("pattern", s.pattern)
    put("params", buildJsonObject {
      put("thickness", s.params.thickness)
      put("speed", s.params.speed)
      put("spread", s.params.spread)
      put("glow", s.params.glow)
      put("padding", s.params.padding)
      put("roundness", s.params.roundness)
      put("mirrored", s.params.mirrored)
      put("clockwise", s.params.clockwise)
    })
    put("colors", buildJsonObject {
      put("source", s.colors.source.key)
      put("palette", buildJsonArray { s.colors.palette.forEach { add(JsonPrimitive(it)) } })
    })
    put("edges", buildJsonObject {
      put("auto", s.edges.auto)
      put("corners", buildJsonArray { s.edges.corners.forEach { add(JsonPrimitive(it)) } })
      put("insets", buildJsonArray { s.edges.insets.forEach { add(JsonPrimitive(it)) } })
    })
  }.toString()

  private fun JsonObject.obj(k: String): JsonObject = this[k] as? JsonObject ?: JsonObject(emptyMap())

  private fun JsonElement?.prim(): JsonPrimitive? = this as? JsonPrimitive

  private fun JsonObject.str(k: String): String? = this[k].prim()?.takeIf { it.isString }?.content

  private fun JsonObject.bool(k: String, d: Boolean): Boolean =
    this[k].prim()?.takeIf { !it.isString }?.booleanOrNull ?: d

  private fun JsonElement?.number(): Double? = prim()?.takeIf { !it.isString }?.doubleOrNull

  private fun JsonObject.num(k: String, d: Double, min: Double, max: Double): Double =
    this[k].number()?.coerceIn(min, max) ?: d

  private fun JsonObject.quad(k: String, max: Double): List<Int> {
    val a = this[k] as? JsonArray
    return List(4) { i -> (a?.getOrNull(i).number()?.coerceIn(0.0, max) ?: 0.0).roundToInt() }
  }
}
