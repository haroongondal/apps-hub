package expo.modules.placereminders.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat

object Notices {
  private const val CHANNEL = "place-reminders"

  /** Private visibility keeps the item title off the lock screen. */
  fun post(context: Context, itemId: String, title: String) {
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Place reminders", NotificationManager.IMPORTANCE_HIGH))
    }
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("pdfeditor://item?id=${Uri.encode(itemId)}"))
      .setPackage(context.packageName)
    val tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val notice = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_dialog_map)
      .setContentTitle("Reminder")
      .setContentText(title)
      .setContentIntent(tap)
      .setAutoCancel(true)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .build()
    manager.notify(itemId.hashCode(), notice)
  }
}
