package expo.modules.haloengine.core

object PowerState {
  const val LOW_PERCENT = 15
  const val ALARM_SOON_MS = 60 * 60_000L

  // BatteryManager's BATTERY_STATUS_CHARGING and _FULL, copied so this stays plain JVM.
  private const val STATUS_CHARGING = 2
  private const val STATUS_FULL = 5

  /** Plugged in counts even when the battery says not charging (a hot or full battery pauses charging). */
  fun charging(status: Int, plugged: Int): Boolean = plugged > 0 || status == STATUS_CHARGING || status == STATUS_FULL

  fun percent(level: Int, scale: Int): Int? = if (level < 0 || scale <= 0) null else level * 100 / scale

  fun lowBattery(percent: Int?, charging: Boolean): Boolean = !charging && percent != null && percent <= LOW_PERCENT

  fun alarmSoon(nextAlarmMs: Long?, nowMs: Long): Boolean = nextAlarmMs != null && nextAlarmMs >= nowMs && nextAlarmMs - nowMs <= ALARM_SOON_MS
}
