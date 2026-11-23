package expo.modules.placereminders.core

const val MIN_RADIUS_M = 100
const val MAX_RADIUS_M = 5000

/** Android reports entering and leaving through one alert; the reminder's trigger decides which notifies. */
fun shouldNotify(trigger: String, entering: Boolean): Boolean = when (trigger) {
  "arrive" -> entering
  "leave" -> !entering
  else -> false
}

fun radiusFor(radiusM: Int): Float = radiusM.coerceIn(MIN_RADIUS_M, MAX_RADIUS_M).toFloat()
