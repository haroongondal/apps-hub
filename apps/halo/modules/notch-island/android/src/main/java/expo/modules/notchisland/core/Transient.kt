package expo.modules.notchisland.core

enum class RingerMode { RING, VIBRATE, SILENT }

sealed interface Transient {
  data class Charging(val plugged: Boolean, val percent: Int?, val wireless: Boolean, val minutesToFull: Int?) : Transient
  data class LowBattery(val percent: Int) : Transient
  data class Ringer(val mode: RingerMode) : Transient
  data class Dnd(val on: Boolean) : Transient
  data class Headset(val connected: Boolean, val name: String?) : Transient
}

/** [event] is the threshold to warn about now; [fired] is the lowest one already warned about, carried to the next reading. */
data class LowBatteryStep(val event: Int?, val fired: Int?)

data class TransientText(val icon: String, val title: String, val subtitle: String?)

object Transients {
  const val HOLD_MS = 2500L
  private val LOW_LEVELS = listOf(10, 20)
  private const val REARM_GAP = 3

  // Null drops the event. A call is never covered and a card the user opened is never replaced; otherwise the newest wins, any kind.
  fun decide(current: Transient?, incoming: Transient, callActive: Boolean, cardOpen: Boolean): Transient? = when {
    callActive || cardOpen -> null
    incoming == current -> null
    else -> incoming
  }

  fun allowed(t: Transient, e: EventSwitches): Boolean = when (t) {
    is Transient.Charging, is Transient.LowBattery -> e.charging
    is Transient.Ringer -> e.ringer
    is Transient.Dnd -> e.dnd
    is Transient.Headset -> e.bluetooth
  }

  const val WIRED_KEY = "wired"
  // AudioDeviceInfo types: 3 wired headset, 4 wired headphones, 22 USB headset; 7 Bluetooth SCO, 8 A2DP, 26 BLE headset. One device's ports share a key.
  fun headsetKey(type: Int, address: String): String? = when (type) {
    3, 4, 22 -> WIRED_KEY
    7, 8, 26 -> "bt:$address"
    else -> null
  }

  /** Headsets keyed as [headsetKey], with their names. Disconnects come first, so a connect in the same change shows last and wins. */
  fun headsetChanges(before: Map<String, String?>, now: Map<String, String?>): List<Transient.Headset> =
    before.filterKeys { it !in now }.map { Transient.Headset(false, it.value) } +
      now.filterKeys { it !in before }.map { Transient.Headset(true, it.value) }

  fun lowBatteryCrossing(previous: Int?, now: Int, plugged: Boolean): Int? =
    if (plugged || previous == null) null else LOW_LEVELS.firstOrNull { previous > it && now <= it }

  // Adds hysteresis: after a threshold fires it stays quiet until the level climbs 3 points above it or the phone is plugged in, so 21, 20, 21, 20 warns once.
  fun lowBatteryStep(previous: Int?, now: Int, plugged: Boolean, fired: Int?): LowBatteryStep {
    if (plugged) return LowBatteryStep(null, null)
    val armedAt = if (fired != null && now >= fired + REARM_GAP) null else fired
    val event = lowBatteryCrossing(previous, now, plugged = false)?.takeIf { armedAt == null || it < armedAt }
    return LowBatteryStep(event, event ?: armedAt)
  }

  fun ringerMode(raw: Int): RingerMode? = when (raw) {
    0 -> RingerMode.SILENT
    1 -> RingerMode.VIBRATE
    2 -> RingerMode.RING
    else -> null
  }

  // INTERRUPTION_FILTER_UNKNOWN (0) and _ALL (1) both mean Do not disturb is off.
  fun dndOn(filter: Int): Boolean = filter > 1

  fun text(t: Transient): TransientText = when (t) {
    is Transient.Charging -> if (t.plugged) {
      TransientText(
        "bolt",
        if (t.wireless) "Charging wirelessly" else "Charging",
        listOfNotNull(t.percent?.let { "${it.coerceIn(0, 100)}%" }, t.minutesToFull?.let(::fullIn)).joinToString("  ·  ").ifEmpty { null },
      )
    } else {
      TransientText("bolt", "Not charging", t.percent?.let { "${it.coerceIn(0, 100)}%" })
    }
    is Transient.LowBattery -> TransientText("battery_low", "Low battery", "${t.percent.coerceIn(0, 100)}% left")
    is Transient.Ringer -> when (t.mode) {
      RingerMode.RING -> TransientText("bell", "Ring", null)
      RingerMode.VIBRATE -> TransientText("bell_off", "Vibrate", null)
      RingerMode.SILENT -> TransientText("bell_off", "Silent", null)
    }
    is Transient.Dnd -> TransientText("moon", if (t.on) "Do not disturb on" else "Do not disturb off", null)
    is Transient.Headset -> {
      val name = t.name?.trim()?.ifEmpty { null }
      val state = if (t.connected) "Connected" else "Disconnected"
      TransientText("headphones", name ?: "Headphones ${state.lowercase()}", state.takeIf { name != null })
    }
  }

  fun fullIn(minutes: Int): String {
    val m = maxOf(1, minutes)
    val h = m / 60
    val rest = m % 60
    return when {
      h == 0 -> "Full in $m min"
      rest == 0 -> "Full in $h h"
      else -> "Full in $h h $rest min"
    }
  }
}
