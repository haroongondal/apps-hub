package expo.modules.haloengine.core

enum class DotShape {
  CIRCLE, // other apps
  BUBBLE, // circle with a speech tail, WhatsApp
  SQUARE_RING, // outlined rounded square, Instagram
  DIAMOND, // missed call
  ROUNDED_SQUARE, // messages
  ENVELOPE, // wide rectangle, email
  BOLT, // charging
  BAR, // short upright bar, low battery
  RING, // outlined circle, alarm
  TRIANGLE, // play triangle, music
}

/** Declaration order is the display order. key is the settings key in aod.dots.kinds; colour is opaque ARGB. */
enum class DotKind(val key: String, val colour: Int, val shape: DotShape) {
  CHARGING("charging", 0xFF00E676.toInt(), DotShape.BOLT),
  LOW_BATTERY("lowBattery", 0xFFFF9100.toInt(), DotShape.BAR),
  CALL("call", 0xFFFF1744.toInt(), DotShape.DIAMOND),
  WHATSAPP("whatsapp", 0xFF25D366.toInt(), DotShape.BUBBLE),
  INSTAGRAM("instagram", 0xFFFF3D9A.toInt(), DotShape.SQUARE_RING),
  MESSAGE("message", 0xFF00E5FF.toInt(), DotShape.ROUNDED_SQUARE),
  EMAIL("email", 0xFFFFEA00.toInt(), DotShape.ENVELOPE),
  OTHER("other", 0xFFFFFFFF.toInt(), DotShape.CIRCLE),
  ALARM("alarm", 0xFFB388FF.toInt(), DotShape.RING),
  MEDIA("media", 0xFF448AFF.toInt(), DotShape.TRIANGLE),
}

data class Dot(val kind: DotKind, val count: Int)

data class DotRow(val dots: List<Dot>, val overflow: Int)

data class DotSystemState(
  val charging: Boolean = false,
  val lowBattery: Boolean = false,
  val alarmSoon: Boolean = false,
  val mediaPlaying: Boolean = false,
)

object DotKinds {
  private val WHATSAPP = setOf("com.whatsapp", "com.whatsapp.w4b")
  private val INSTAGRAM = setOf("com.instagram.android")
  private val DIALERS = setOf(
    "com.android.dialer", "com.google.android.dialer", "com.samsung.android.dialer", "com.android.incallui", "com.android.server.telecom",
  )
  private val SMS = setOf("com.android.mms", "com.android.messaging", "com.google.android.apps.messaging", "com.samsung.android.messaging")
  private val EMAIL = setOf("com.google.android.gm")

  // The brand comes first, so a WhatsApp missed call is still a WhatsApp dot.
  fun classify(pkg: String, category: String?): DotKind = when {
    pkg in WHATSAPP -> DotKind.WHATSAPP
    pkg in INSTAGRAM -> DotKind.INSTAGRAM
    category == "call" || category == "missed_call" || pkg in DIALERS -> DotKind.CALL
    category == "msg" || pkg in SMS -> DotKind.MESSAGE
    category == "email" || pkg in EMAIL -> DotKind.EMAIL
    else -> DotKind.OTHER
  }

  fun brandColour(pkg: String): Int? = classify(pkg, null).takeIf { it == DotKind.WHATSAPP || it == DotKind.INSTAGRAM }?.colour

  fun dots(notes: List<NoteGroup>, system: DotSystemState, enabled: Set<DotKind>, max: Int = 8): DotRow {
    val counts = HashMap<DotKind, Int>()
    for (g in notes) classify(g.pkg, g.category).let { counts[it] = (counts[it] ?: 0) + g.count }
    if (system.charging) counts[DotKind.CHARGING] = 1
    if (system.lowBattery && !system.charging) counts[DotKind.LOW_BATTERY] = 1
    if (system.alarmSoon) counts[DotKind.ALARM] = 1
    if (system.mediaPlaying) counts[DotKind.MEDIA] = 1
    val all = DotKind.entries.filter { it in enabled && (counts[it] ?: 0) > 0 }.map { Dot(it, counts.getValue(it)) }
    val shown = all.take(max.coerceAtLeast(0))
    return DotRow(shown, all.size - shown.size)
  }
}
