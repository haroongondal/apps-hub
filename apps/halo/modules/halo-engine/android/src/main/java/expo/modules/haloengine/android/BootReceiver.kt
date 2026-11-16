package expo.modules.haloengine.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Spike: start path (b). Android 15+ forbids a mediaPlayback foreground service from boot, so this asks for specialUse. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    ProbeLog.log(context, "boot", "received action=${intent.action}")
    try {
      HaloService.start(context, HaloService.SPECIAL_USE, "boot")
    } catch (e: Exception) {
      ProbeLog.log(context, "boot", "start FAILED ${e.javaClass.name}: ${e.message}")
    }
  }
}
