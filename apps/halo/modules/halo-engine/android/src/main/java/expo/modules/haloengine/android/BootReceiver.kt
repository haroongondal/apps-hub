package expo.modules.haloengine.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Start path (b), and after an app update. Android 15+ forbids a mediaPlayback foreground service from boot, so this asks for specialUse. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    ProbeLog.log(context, "boot", "received action=${intent.action}")
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (!SettingsStore.serviceWanted(context)) {
      ProbeLog.log(context, "boot", "not starting: lights off")
      return
    }
    try {
      HaloService.start(context, HaloService.SPECIAL_USE, if (intent.action == Intent.ACTION_BOOT_COMPLETED) "boot" else "updated")
    } catch (e: Exception) {
      ProbeLog.log(context, "boot", "start FAILED ${e.javaClass.name}: ${e.message}")
    }
  }
}
