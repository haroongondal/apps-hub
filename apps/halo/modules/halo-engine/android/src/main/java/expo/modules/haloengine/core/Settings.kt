package expo.modules.haloengine.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
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

/** colour is "#RRGGBB", or null for the brand or icon colour; style null follows SettingsNotify.style. */
data class AppNotify(val on: Boolean = true, val colour: String? = null, val style: String? = null)

data class SettingsQuiet(val on: Boolean = false, val start: String = "22:00", val end: String = "07:00")

data class SettingsNotify(
  val enabled: Boolean = true,
  val apps: Map<String, AppNotify> = emptyMap(),
  val defaultOn: Boolean = true,
  val style: String = "pulse", // "pulse", "sweep" or any edge pattern id
  val repeat: Int = 2, // 1..5
  val durationMs: Int = 1500, // 500..5000
  val reminderMin: Int? = null, // 1, 2, 5, 10, 15 or null
  val wakeScreen: Boolean = false, // used in stage 4
  val quiet: SettingsQuiet = SettingsQuiet(),
)

data class SettingsRules(
  val apps: List<String> = emptyList(),
  val fullscreen: Boolean = true,
  val landscape: Boolean = false,
  val calls: Boolean = true,
  val batterySaver: Boolean = true,
  val pocket: Boolean = false,
)

enum class AodTrigger(val key: String) { ALWAYS("always"), CHARGING("charging"), MUSIC("music") }

/** Off hours: the always-on screen stays off inside this window (may cross midnight). */
data class AodSchedule(val on: Boolean = false, val start: String = "00:00", val end: String = "07:00")

data class AodSlot(val start: String, val themeId: String)

/** kinds holds the enabled dot kinds; count shows the number on a dot of two or more. */
data class AodDots(val on: Boolean = true, val kinds: Set<DotKind> = DotKind.entries.toSet(), val count: Boolean = true)

enum class ChargeEffect(val key: String) { OFF("off"), SWEEP("sweep") }

data class SettingsAod(
  val enabled: Boolean = false,
  val timeoutSec: Int? = 30, // 10, 30, 60, 300, 900, 1800 or null = never stop
  val trigger: AodTrigger = AodTrigger.ALWAYS,
  val schedule: AodSchedule = AodSchedule(),
  val themeId: String = "night",
  val slots: List<AodSlot> = emptyList(), // max 4
  val dots: AodDots = AodDots(),
  val chargeEffect: ChargeEffect = ChargeEffect.SWEEP,
  val wakeOnCharge: Boolean = true, // plug-in with the screen off wakes the always-on screen, unless in a pocket
)

data class FaceOptions(
  val size: String = "m", // "s", "m", "l"
  val position: String = "centre", // "top", "centre", "bottom"
  val h24: Boolean = true,
  val date: Boolean = true,
  val battery: Boolean = true,
  val alarm: Boolean = false,
  val seconds: Boolean = false,
)

data class ThemeEdge(val on: Boolean = true, val pattern: String = "pulse-ring")

/** The photo, when `photo` is true, is the file filesDir/bg/<id>.jpg. */
data class Theme(
  val id: String,
  val name: String,
  val face: String,
  val faceOptions: FaceOptions = FaceOptions(),
  val colours: SettingsColors = SettingsColors(ColorSource.PALETTE, listOf("#FFFFFF")),
  val photo: Boolean = false,
  val dim: Double = 0.5,
  val edge: ThemeEdge = ThemeEdge(),
  val brightness: Double = 0.02,
)

/** Surfaces fed by the owner's other apps. Each switch also decides which shares Halo reads; all off by default. */
data class SettingsLinks(
  val shieldPulse: Boolean = false,
  val waitingPulse: Boolean = false,
  val waitingAod: Boolean = false,
  val bubble: Boolean = false,
  val briefing: Boolean = false,
  val briefingPrivate: Boolean = false,
)

val SettingsLinks.readsWaiting: Boolean get() = waitingPulse || waitingAod || bubble
val SettingsLinks.any: Boolean get() = shieldPulse || readsWaiting || briefing

data class Settings(
  val enabled: Boolean = true,
  val pattern: String = "pulse-ring",
  val params: SettingsParams = SettingsParams(),
  val colors: SettingsColors = SettingsColors(),
  val edges: SettingsEdges = SettingsEdges(),
  val notify: SettingsNotify = SettingsNotify(),
  val rules: SettingsRules = SettingsRules(),
  val aod: SettingsAod = SettingsAod(),
  val themes: List<Theme> = STARTER_THEMES,
  val links: SettingsLinks = SettingsLinks(),
)

/** The foreground service is needed for the lights, the always-on screen (its screen-off receiver) or notification wakes. */
val Settings.serviceWanted: Boolean get() = enabled || aod.enabled || notify.enabled || links.shieldPulse || links.waitingPulse || links.bubble

val STARTER_THEMES: List<Theme> = listOf(
  Theme("night", "Night", "big-digits", colours = SettingsColors(ColorSource.WALLPAPER, listOf("#FFFFFF")), edge = ThemeEdge(on = false)),
  Theme("pulse", "Pulse", "ring-analog", colours = SettingsColors(ColorSource.ALBUM_ART, listOf("#22D3EE", "#A78BFA")), edge = ThemeEdge(on = true, pattern = "pulse-wave")),
  Theme("glass", "Glass", "stacked", colours = SettingsColors(ColorSource.PALETTE, listOf("#A78BFA", "#22D3EE")), edge = ThemeEdge(on = false), dim = 0.6),
  Theme("mono", "Mono", "minimal-line", colours = SettingsColors(ColorSource.PALETTE, listOf("#FFFFFF"))),
)

/** Mirrors apps/halo/modules/halo-engine/src/settings.ts; both run fixtures/settings.cases.json. */
object SettingsCodec {
  private val HEX = Regex("^#[0-9a-fA-F]{6}$")
  private val ID = Regex("^[a-z0-9-]{1,40}$")
  private val PKG = Regex("^[a-zA-Z0-9_.]{1,200}$")
  private val TIME = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
  private const val MAX_APPS = 500
  private const val MAX_THEMES = 20
  private const val MAX_SLOTS = 4
  private val TIMEOUTS = listOf(10, 30, 60, 300, 900, 1800)
  private val SIZES = listOf("s", "m", "l")
  private val POSITIONS = listOf("top", "centre", "bottom")
  private val REMINDERS = listOf(1, 2, 5, 10, 15)
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
      notify = decodeNotify(root.obj("notify")),
      rules = decodeRules(root.obj("rules")),
      aod = decodeAod(root.obj("aod")),
      themes = decodeThemes(root["themes"]),
      links = root.obj("links").let { l ->
        val d = D.links
        SettingsLinks(
          shieldPulse = l.bool("shieldPulse", d.shieldPulse),
          waitingPulse = l.bool("waitingPulse", d.waitingPulse),
          waitingAod = l.bool("waitingAod", d.waitingAod),
          bubble = l.bool("bubble", d.bubble),
          briefing = l.bool("briefing", d.briefing),
          briefingPrivate = l.bool("briefingPrivate", d.briefingPrivate),
        )
      },
    )
  }

  private fun decodeAod(a: JsonObject): SettingsAod {
    val d = D.aod
    val sc = a.obj("schedule")
    val t = a["timeoutSec"]
    return SettingsAod(
      enabled = a.bool("enabled", d.enabled),
      // null (JSON null) means never stop; a missing or unknown value is the default.
      timeoutSec = if (t is JsonNull) null else TIMEOUTS.firstOrNull { it.toDouble() == t.number() } ?: d.timeoutSec,
      trigger = AodTrigger.entries.firstOrNull { it.key == a.str("trigger") } ?: d.trigger,
      schedule = AodSchedule(
        on = sc.bool("on", d.schedule.on),
        start = sc.str("start")?.takeIf { TIME.matches(it) } ?: d.schedule.start,
        end = sc.str("end")?.takeIf { TIME.matches(it) } ?: d.schedule.end,
      ),
      themeId = a.str("themeId")?.takeIf { ID.matches(it) } ?: d.themeId,
      slots = (a["slots"] as? JsonArray).orEmpty().mapNotNull { e ->
        val o = e as? JsonObject ?: return@mapNotNull null
        val start = o.str("start")?.takeIf { TIME.matches(it) } ?: return@mapNotNull null
        val id = o.str("themeId")?.takeIf { ID.matches(it) } ?: return@mapNotNull null
        AodSlot(start, id)
      }.take(MAX_SLOTS),
      dots = a.obj("dots").let { o ->
        val k = o.obj("kinds")
        AodDots(
          on = o.bool("on", d.dots.on),
          kinds = DotKind.entries.filter { k.bool(it.key, true) }.toSet(),
          count = o.bool("count", d.dots.count),
        )
      },
      chargeEffect = ChargeEffect.entries.firstOrNull { it.key == a.str("chargeEffect") } ?: d.chargeEffect,
      wakeOnCharge = a.bool("wakeOnCharge", d.wakeOnCharge),
    )
  }

  /** A missing, empty or all-invalid list gives the starter themes; a repeated id keeps the first. */
  private fun decodeThemes(raw: JsonElement?): List<Theme> {
    val seen = HashSet<String>()
    val out = (raw as? JsonArray).orEmpty()
      .mapNotNull { (it as? JsonObject)?.let(::decodeTheme) }
      .filter { seen.add(it.id) }
      .take(MAX_THEMES)
    return out.ifEmpty { STARTER_THEMES }
  }

  /** 40 UTF-16 units; a cut that splits an emoji drops the lone high surrogate (settings.ts cutName does the same). Empty gives null. */
  private fun cutName(s: String): String? = s.take(40).let { if (it.lastOrNull()?.isHighSurrogate() == true) it.dropLast(1) else it }.takeIf { it.isNotEmpty() }

  private fun decodeTheme(t: JsonObject): Theme? {
    val id = t.str("id")?.takeIf { ID.matches(it) } ?: return null
    val d = Theme(id, id, "big-digits")
    val f = t.obj("faceOptions")
    val c = t.obj("colours")
    val e = t.obj("edge")
    val palette = (c["palette"] as? JsonArray).orEmpty()
      .mapNotNull { (it as? JsonPrimitive)?.takeIf { s -> s.isString }?.content }
      .filter { HEX.matches(it) }
      .take(4)
      .map { it.uppercase() }
    return Theme(
      id = id,
      name = t.str("name")?.let(::cutName) ?: id,
      face = t.str("face")?.takeIf { ID.matches(it) } ?: d.face,
      faceOptions = FaceOptions(
        size = f.str("size")?.takeIf { it in SIZES } ?: d.faceOptions.size,
        position = f.str("position")?.takeIf { it in POSITIONS } ?: d.faceOptions.position,
        h24 = f.bool("h24", d.faceOptions.h24),
        date = f.bool("date", d.faceOptions.date),
        battery = f.bool("battery", d.faceOptions.battery),
        alarm = f.bool("alarm", d.faceOptions.alarm),
        seconds = f.bool("seconds", d.faceOptions.seconds),
      ),
      colours = SettingsColors(
        source = ColorSource.entries.firstOrNull { it.key == c.str("source") } ?: d.colours.source,
        palette = palette.ifEmpty { d.colours.palette },
      ),
      photo = t.bool("photo", d.photo),
      dim = t.num("dim", d.dim, 0.0, 0.9),
      edge = ThemeEdge(on = e.bool("on", d.edge.on), pattern = e.str("pattern")?.takeIf { ID.matches(it) } ?: d.edge.pattern),
      brightness = t.num("brightness", d.brightness, 0.005, 0.3),
    )
  }

  private fun decodeNotify(n: JsonObject): SettingsNotify {
    val d = D.notify
    val q = n.obj("quiet")
    val apps = LinkedHashMap<String, AppNotify>()
    for ((k, v) in n.obj("apps")) {
      if (apps.size >= MAX_APPS) break
      val a = v as? JsonObject ?: continue
      if (!PKG.matches(k)) continue
      apps[k] = AppNotify(a.bool("on", true), a.str("colour")?.takeIf { HEX.matches(it) }?.uppercase(), a.str("style")?.takeIf { ID.matches(it) })
    }
    return SettingsNotify(
      enabled = n.bool("enabled", d.enabled),
      apps = apps,
      defaultOn = n.bool("defaultOn", d.defaultOn),
      style = n.str("style")?.takeIf { ID.matches(it) } ?: d.style,
      repeat = n.num("repeat", d.repeat.toDouble(), 1.0, 5.0).roundToInt(),
      durationMs = n.num("durationMs", d.durationMs.toDouble(), 500.0, 5000.0).roundToInt(),
      reminderMin = REMINDERS.firstOrNull { it.toDouble() == n["reminderMin"].number() },
      wakeScreen = n.bool("wakeScreen", d.wakeScreen),
      quiet = SettingsQuiet(
        on = q.bool("on", d.quiet.on),
        start = q.str("start")?.takeIf { TIME.matches(it) } ?: d.quiet.start,
        end = q.str("end")?.takeIf { TIME.matches(it) } ?: d.quiet.end,
      ),
    )
  }

  private fun decodeRules(r: JsonObject): SettingsRules {
    val d = D.rules
    return SettingsRules(
      apps = (r["apps"] as? JsonArray).orEmpty()
        .mapNotNull { (it as? JsonPrimitive)?.takeIf { s -> s.isString }?.content }
        .filter { PKG.matches(it) }
        .take(MAX_APPS),
      fullscreen = r.bool("fullscreen", d.fullscreen),
      landscape = r.bool("landscape", d.landscape),
      calls = r.bool("calls", d.calls),
      batterySaver = r.bool("batterySaver", d.batterySaver),
      pocket = r.bool("pocket", d.pocket),
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
    put("notify", buildJsonObject {
      put("enabled", s.notify.enabled)
      put("apps", buildJsonObject {
        s.notify.apps.forEach { (k, a) ->
          put(k, buildJsonObject {
            put("on", a.on)
            put("colour", a.colour)
            put("style", a.style)
          })
        }
      })
      put("defaultOn", s.notify.defaultOn)
      put("style", s.notify.style)
      put("repeat", s.notify.repeat)
      put("durationMs", s.notify.durationMs)
      put("reminderMin", s.notify.reminderMin)
      put("wakeScreen", s.notify.wakeScreen)
      put("quiet", buildJsonObject {
        put("on", s.notify.quiet.on)
        put("start", s.notify.quiet.start)
        put("end", s.notify.quiet.end)
      })
    })
    put("rules", buildJsonObject {
      put("apps", buildJsonArray { s.rules.apps.forEach { add(JsonPrimitive(it)) } })
      put("fullscreen", s.rules.fullscreen)
      put("landscape", s.rules.landscape)
      put("calls", s.rules.calls)
      put("batterySaver", s.rules.batterySaver)
      put("pocket", s.rules.pocket)
    })
    put("aod", buildJsonObject {
      put("enabled", s.aod.enabled)
      put("timeoutSec", s.aod.timeoutSec)
      put("trigger", s.aod.trigger.key)
      put("schedule", buildJsonObject {
        put("on", s.aod.schedule.on)
        put("start", s.aod.schedule.start)
        put("end", s.aod.schedule.end)
      })
      put("themeId", s.aod.themeId)
      put("slots", buildJsonArray {
        s.aod.slots.forEach { add(buildJsonObject { put("start", it.start); put("themeId", it.themeId) }) }
      })
      put("dots", buildJsonObject {
        put("on", s.aod.dots.on)
        put("kinds", buildJsonObject { DotKind.entries.forEach { put(it.key, it in s.aod.dots.kinds) } })
        put("count", s.aod.dots.count)
      })
      put("chargeEffect", s.aod.chargeEffect.key)
      put("wakeOnCharge", s.aod.wakeOnCharge)
    })
    put("themes", buildJsonArray {
      s.themes.forEach { t ->
        add(buildJsonObject {
          put("id", t.id)
          put("name", t.name)
          put("face", t.face)
          put("faceOptions", buildJsonObject {
            put("size", t.faceOptions.size)
            put("position", t.faceOptions.position)
            put("h24", t.faceOptions.h24)
            put("date", t.faceOptions.date)
            put("battery", t.faceOptions.battery)
            put("alarm", t.faceOptions.alarm)
            put("seconds", t.faceOptions.seconds)
          })
          put("colours", buildJsonObject {
            put("source", t.colours.source.key)
            put("palette", buildJsonArray { t.colours.palette.forEach { add(JsonPrimitive(it)) } })
          })
          put("photo", t.photo)
          put("dim", t.dim)
          put("edge", buildJsonObject {
            put("on", t.edge.on)
            put("pattern", t.edge.pattern)
          })
          put("brightness", t.brightness)
        })
      }
    })
    put("links", buildJsonObject {
      put("shieldPulse", s.links.shieldPulse)
      put("waitingPulse", s.links.waitingPulse)
      put("waitingAod", s.links.waitingAod)
      put("bubble", s.links.bubble)
      put("briefing", s.links.briefing)
      put("briefingPrivate", s.links.briefingPrivate)
    })
  }.toString()

  private fun JsonObject.obj(k: String): JsonObject = this[k] as? JsonObject ?: JsonObject(emptyMap())

  private fun JsonElement?.prim(): JsonPrimitive? = this as? JsonPrimitive

  private fun JsonObject.str(k: String): String? = this[k].prim()?.takeIf { it.isString }?.content

  private fun JsonObject.bool(k: String, d: Boolean): Boolean =
    this[k].prim()?.takeIf { !it.isString }?.booleanOrNull ?: d

  // The lenient parser reads bare NaN and Infinity as numbers; they fall back like any other bad value (settings.ts does the same).
  private fun JsonElement?.number(): Double? = prim()?.takeIf { !it.isString }?.doubleOrNull?.takeIf { it.isFinite() }

  private fun JsonObject.num(k: String, d: Double, min: Double, max: Double): Double =
    this[k].number()?.coerceIn(min, max) ?: d

  private fun JsonObject.quad(k: String, max: Double): List<Int> {
    val a = this[k] as? JsonArray
    return List(4) { i -> (a?.getOrNull(i).number()?.coerceIn(0.0, max) ?: 0.0).roundToInt() }
  }
}
