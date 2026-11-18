package expo.modules.inflowcore.android

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.inflowcore.R
import expo.modules.inflowcore.core.ReportKind

/** The "your report is ready" notification. On the lock screen it says only that a report is ready; the amounts show once the phone is unlocked. */
object ReportNotifier {
  const val CHANNEL = "reports"
  const val EXTRA = "inflow.reportId"

  /** Silently does nothing when the owner has not allowed notifications. */
  fun notify(ctx: Context, reportId: Long, headline: String, kind: ReportKind) {
    if (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
    val manager = NotificationManagerCompat.from(ctx)
    if (!manager.areNotificationsEnabled()) return
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.putExtra(EXTRA, reportId) ?: return
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "Reports", NotificationManager.IMPORTANCE_DEFAULT))
    val tap = PendingIntent.getActivity(ctx, reportId.toInt(), launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val ready = "Your ${if (kind == ReportKind.WEEKLY) "weekly" else "monthly"} report is ready"
    val public = NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.inflow_report).setContentTitle(ready).build()
    val n = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(R.drawable.inflow_report).setContentTitle(ready).setContentText(headline)
      .setStyle(NotificationCompat.BigTextStyle().bigText(headline))
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(public)
      .setContentIntent(tap).setAutoCancel(true).build()
    manager.notify(reportId.toInt(), n)
  }

  fun allowed(ctx: Context): Boolean =
    ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED && NotificationManagerCompat.from(ctx).areNotificationsEnabled()
}
