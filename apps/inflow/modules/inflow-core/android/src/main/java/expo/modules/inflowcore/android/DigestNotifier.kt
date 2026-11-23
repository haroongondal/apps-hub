package expo.modules.inflowcore.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.inflowcore.R
import expo.modules.inflowcore.core.DigestContent

/** The 08:00 and 20:00 summary. Private: the lines show only once the phone is unlocked; the public version holds the count and never a line. */
object DigestNotifier {
  const val CHANNEL = "daily_summary"
  private const val TAG = "digest"
  private const val CONTENT_CODE = 3_000_000   // clear of the other notifiers' request codes
  private val FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  /** Does nothing when notifications are off. One notification per kind: a new one replaces the older of its kind. */
  fun post(ctx: Context, c: DigestContent) {
    if (!ReportNotifier.allowed(ctx)) return
    val manager = NotificationManagerCompat.from(ctx)
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "Daily summary", NotificationManager.IMPORTANCE_LOW))
    val public = NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.inflow_report).setContentTitle(c.title).setContentText(c.publicText).build()
    val b = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(R.drawable.inflow_report).setContentTitle(c.title).setContentText(c.lines.first())
      .setStyle(NotificationCompat.InboxStyle().also { s -> c.lines.forEach { s.addLine(it) } })
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(public)
      .setAutoCancel(true).setOnlyAlertOnce(true)
    // The app's own launcher screen: the fingerprint lock stays in front of everything.
    ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let { b.setContentIntent(PendingIntent.getActivity(ctx, CONTENT_CODE + c.kind.ordinal, it, FLAGS)) }
    manager.notify(TAG, c.kind.ordinal + 1, b.build())
  }
}
