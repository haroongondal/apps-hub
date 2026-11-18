package expo.modules.notchisland.core

private val DAYS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

// The caller resolves the "system" clock setting first; this takes "12" or "24".
fun clockText(hour24: Int, minute: Int, clock: String): String {
  val m = minute.toString().padStart(2, '0')
  return if (clock == "24") "${hour24.toString().padStart(2, '0')}:$m"
  else "${(hour24 % 12).let { if (it == 0) 12 else it }}:$m"
}

// dayOfWeek is java.util.Calendar's (1 = Sunday); month is 0-based.
fun dateText(dayOfWeek: Int, dayOfMonth: Int, month: Int): String =
  "${DAYS[dayOfWeek - 1]} $dayOfMonth ${MONTHS[month]}"

fun alarmLine(hour24: Int?, minute: Int, clock: String): String? =
  hour24?.let { "Alarm ${clockText(it, minute, clock)}" }

fun batteryText(percent: Int, charging: Boolean): String {
  val p = percent.coerceIn(0, 100)
  return if (charging) "$p% charging" else "$p%"
}

fun durationText(ms: Long): String {
  val total = maxOf(0L, ms) / 1000
  val h = total / 3600
  val m = (total % 3600) / 60
  val s = total % 60
  val ss = s.toString().padStart(2, '0')
  return if (h > 0) "$h:${m.toString().padStart(2, '0')}:$ss" else "${m.toString().padStart(2, '0')}:$ss"
}
