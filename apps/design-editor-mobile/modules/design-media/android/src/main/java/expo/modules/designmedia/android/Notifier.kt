package expo.modules.designmedia.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.graphics.drawable.Icon
import expo.modules.designmedia.core.Messages

class Notifier(private val context: Context) {
  private val manager = context.getSystemService(NotificationManager::class.java)

  init {
    manager.createNotificationChannel(NotificationChannel(CHANNEL, Messages.CHANNEL, NotificationManager.IMPORTANCE_LOW))
  }

  fun build(title: String, text: String, percent: Int, cancel: PendingIntent): Notification =
    Notification.Builder(context, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(title)
      .setContentText(text)
      .setProgress(100, percent, false)
      .setOngoing(true)
      .addAction(
        Notification.Action.Builder(
          Icon.createWithResource(context, android.R.drawable.ic_menu_close_clear_cancel),
          Messages.CANCEL,
          cancel,
        ).build(),
      )
      .build()

  fun show(id: Int, notification: Notification) = manager.notify(id, notification)

  companion object {
    const val CHANNEL = "media-jobs"
  }
}
