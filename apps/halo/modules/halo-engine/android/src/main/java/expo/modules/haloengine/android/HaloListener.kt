package expo.modules.haloengine.android

import android.service.notification.NotificationListenerService

/** Spike: start path (c). The system binds the listener after boot too, which may allow a start the boot receiver cannot. */
class HaloListener : NotificationListenerService() {
  override fun onListenerConnected() {
    ProbeLog.log(this, "listener", "onListenerConnected serviceRunning=${HaloService.running}")
    if (!HaloService.running) HaloService.start(this, HaloService.MEDIA_PLAYBACK, "listener") else HaloService.onListener?.invoke()
  }

  override fun onListenerDisconnected() {
    ProbeLog.log(this, "listener", "onListenerDisconnected")
  }
}
