package expo.modules.haloengine.android

import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import expo.modules.haloengine.core.PowerState

class PowerWatch(private val ctx: Context, private val onChange: (pluggedIn: Boolean) -> Unit) {
  var charging = false
    private set
  var lowBattery = false
    private set
  var alarmSoon = false
    private set
  private var percent: Int? = null
  private var registered = false

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, i: Intent) {
      when (i.action) {
        Intent.ACTION_BATTERY_CHANGED -> read(i)
        Intent.ACTION_POWER_CONNECTED -> charging = true
        Intent.ACTION_POWER_DISCONNECTED -> charging = false
        else -> return
      }
      lowBattery = PowerState.lowBattery(percent, charging)
      // Only the plug-in broadcast is a plug-in: the sticky state at start, or a late battery update after unplugging, must not sweep.
      onChange(i.action == Intent.ACTION_POWER_CONNECTED)
    }
  }

  fun start() {
    if (registered) return
    val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED).apply {
      addAction(Intent.ACTION_POWER_CONNECTED)
      addAction(Intent.ACTION_POWER_DISCONNECTED)
    }
    // The system sends all three, so not-exported still receives them; the sticky return is read now so the first draw is right.
    ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)?.let(::read)
    registered = true
    lowBattery = PowerState.lowBattery(percent, charging)
    refreshAlarm()
  }

  fun stop() {
    if (registered) runCatching { ctx.unregisterReceiver(receiver) }
    registered = false
  }

  fun refreshAlarm(): Boolean {
    val next = ctx.getSystemService(AlarmManager::class.java)?.nextAlarmClock?.triggerTime
    val soon = PowerState.alarmSoon(next, System.currentTimeMillis())
    if (soon == alarmSoon) return false
    alarmSoon = soon
    return true
  }

  private fun read(i: Intent) {
    charging = PowerState.charging(i.getIntExtra(BatteryManager.EXTRA_STATUS, -1), i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0))
    percent = PowerState.percent(i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), i.getIntExtra(BatteryManager.EXTRA_SCALE, -1))
  }
}
