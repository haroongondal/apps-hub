package expo.modules.notchisland.android

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.BatteryManager
import expo.modules.notchisland.core.RingerMode
import expo.modules.notchisland.core.Transient
import expo.modules.notchisland.core.Transients

// Events fire only on a change from the last known state, so sticky replays at registration stay quiet. Plug and unplug come from BATTERY_CHANGED, not POWER_CONNECTED, which can arrive before the plug type and level are updated.
class NotchEvents(private val context: Context, private val onRefresh: () -> Unit, private val onEvent: (Transient) -> Unit) {
  private var receiver: BroadcastReceiver? = null
  private var plugged: Boolean? = null
  private var level: Int? = null
  private var lowFired: Int? = null
  private var ringer: RingerMode? = null
  private var dnd: Boolean? = null
  private val headsets = HeadsetWatch(context, onEvent)

  fun register() {
    ringer = Transients.ringerMode(context.getSystemService(AudioManager::class.java).ringerMode)
    dnd = Transients.dndOn(context.getSystemService(NotificationManager::class.java).currentInterruptionFilter)
    val r = object : BroadcastReceiver() {
      override fun onReceive(c: Context, intent: Intent) {
        when (intent.action) {
          Intent.ACTION_TIME_TICK -> onRefresh()
          Intent.ACTION_BATTERY_CHANGED -> {
            onRefresh()
            battery(intent)
          }
          AudioManager.RINGER_MODE_CHANGED_ACTION -> {
            val mode = Transients.ringerMode(intent.getIntExtra(AudioManager.EXTRA_RINGER_MODE, -1)) ?: return
            if (mode != ringer) {
              ringer = mode
              onEvent(Transient.Ringer(mode))
            }
          }
          NotificationManager.ACTION_INTERRUPTION_FILTER_CHANGED -> {
            val on = Transients.dndOn(context.getSystemService(NotificationManager::class.java).currentInterruptionFilter)
            if (on != dnd) {
              dnd = on
              onEvent(Transient.Dnd(on))
            }
          }
        }
      }
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_TIME_TICK)
      addAction(Intent.ACTION_BATTERY_CHANGED)
      addAction(AudioManager.RINGER_MODE_CHANGED_ACTION)
      addAction(NotificationManager.ACTION_INTERRUPTION_FILTER_CHANGED)
    }
    receiver = r
    // System broadcasts only, so an exported receiver is safe.
    context.registerReceiver(r, filter, Context.RECEIVER_EXPORTED)
    headsets.register()
  }

  fun unregister() {
    receiver?.let { runCatching { context.unregisterReceiver(it) } }
    receiver = null
    headsets.unregister()
  }

  private fun battery(intent: Intent) {
    val raw = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
    val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
    val percent = if (raw >= 0 && scale > 0) raw * 100 / scale else null
    val type = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
    val now = type != 0
    val wasPlugged = plugged
    val wasLevel = level
    plugged = now
    level = percent ?: wasLevel
    if (wasPlugged != null && wasPlugged != now) {
      onEvent(Transient.Charging(now, percent, type == BatteryManager.BATTERY_PLUGGED_WIRELESS, if (now) minutesToFull() else null))
    }
    if (percent == null) return
    val step = Transients.lowBatteryStep(wasLevel, percent, now, lowFired)
    lowFired = step.fired
    if (step.event != null && wasPlugged == now) onEvent(Transient.LowBattery(percent))
  }

  private fun minutesToFull(): Int? =
    context.getSystemService(BatteryManager::class.java).computeChargeTimeRemaining().takeIf { it > 0 }?.let { (it / 60_000).toInt() }
}
