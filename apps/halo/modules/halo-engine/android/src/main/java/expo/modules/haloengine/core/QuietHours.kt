package expo.modules.haloengine.core

/** A daily window "HH:MM" to "HH:MM" that may cross midnight. Equal start and end mean no window at all. */
object QuietHours {
  fun active(on: Boolean, start: String, end: String, minuteOfDay: Int): Boolean {
    if (!on) return false
    val s = minutes(start) ?: return false
    val e = minutes(end) ?: return false
    return when {
      s == e -> false
      s < e -> minuteOfDay in s until e
      else -> minuteOfDay >= s || minuteOfDay < e
    }
  }

  private fun minutes(t: String): Int? {
    val h = t.substringBefore(':', "").toIntOrNull() ?: return null
    val m = t.substringAfter(':', "").toIntOrNull() ?: return null
    return if (h in 0..23 && m in 0..59) h * 60 + m else null
  }
}
