package expo.modules.haloengine.android

import android.content.ComponentName
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import expo.modules.notchisland.android.NotchFeed

/** Spike: start path (c). The system binds the listener after boot too, which may allow a start the boot receiver cannot. The app's only notification listener: Notch's pill is fed from here too. */
class HaloListener : NotificationListenerService() {
  private val notch by lazy { NotchFeed(this) }

  override fun onListenerConnected() {
    ProbeLog.log(this, "listener", "onListenerConnected serviceRunning=${HaloService.running}")
    notch.connected(ComponentName(this, HaloListener::class.java))
    NotifyFlash.attach(this)
    runCatching { NotifyFlash.restore(this, activeNotifications ?: emptyArray(), currentRanking) }
      .onFailure { ProbeLog.log(this, "notify", "restore FAILED ${it.javaClass.name}") }
    when {
      HaloService.running -> HaloService.onListener?.invoke()
      SettingsStore.serviceWanted(this) -> HaloService.start(this, HaloService.MEDIA_PLAYBACK, "listener")
      else -> ProbeLog.log(this, "listener", "not starting: lights off")
    }
  }

  override fun onListenerDisconnected() {
    ProbeLog.log(this, "listener", "onListenerDisconnected")
    notch.disconnected()
    NotifyFlash.detach(this)
  }

  override fun onDestroy() {
    NotifyFlash.detach(this)
    super.onDestroy()
  }

  override fun onNotificationPosted(sbn: StatusBarNotification, rankingMap: RankingMap?) {
    notch.posted(sbn)
    NotifyFlash.posted(this, sbn, rankingMap)
  }

  override fun onNotificationRemoved(sbn: StatusBarNotification) {
    notch.removed(sbn)
    NotifyFlash.removed(sbn.key)
  }
}
