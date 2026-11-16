package expo.modules.inflowcore.android

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import expo.modules.inflowcore.core.Email
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class InflowListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val posted = sbn ?: return
    executor.execute { capture(posted) }
  }

  override fun onNotificationRemoved(sbn: StatusBarNotification?) = Unit

  override fun onListenerConnected() {
    connected.set(true)
    GmailSync.startPeriodic(applicationContext)
    AiRunner.startPeriodic(applicationContext)
  }

  override fun onListenerDisconnected() {
    connected.set(false)
    rebind(applicationContext)
  }

  private fun capture(sbn: StatusBarNotification) {
    try {
      val store = StoreHolder.get(applicationContext).getOrNull()
      if (store == null) {
        Log.w(TAG, "store unavailable, notification dropped")
        return
      }
      val ingest = StoreHolder.ingest(applicationContext, store) { schedulePurge(applicationContext, it) }
      val reader = MediaReader(applicationContext, store::bump) { store.setMeta("mediaLastMime", it) }
      val raw = RawFromSbn.from(sbn, label(applicationContext, sbn.packageName), reader)
      val saved = store.inTransaction { ingest.onNotification(raw) }
      store.setMeta(LAST_CAPTURE_AT, System.currentTimeMillis().toString())
      if (saved > 0) StoreHolder.onCaptured?.invoke(saved)
      // The notification says an email arrived; fetch its full text soon (coalesced).
      if (raw.pkg == Email.GMAIL) GmailSync.schedule(applicationContext, 10_000)
    } catch (e: Exception) {
      Log.w(TAG, "capture failed: ${e.javaClass.simpleName}")
    }
  }

  companion object {
    const val LAST_CAPTURE_AT = "lastCaptureAt"
    private const val TAG = "InflowListener"
    val connected = AtomicBoolean(false)
    val executor = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "inflow-capture").apply { isDaemon = true } }

    // shortcut: an in-process timer dies with the process; then the OTP stays hidden and is purged on the next
    // notification or when Home opens. Use AlarmManager if the phone check shows HyperOS kills the listener often.
    fun schedulePurge(ctx: Context, expiresAt: Long) {
      executor.schedule({
        try {
          StoreHolder.get(ctx).getOrNull()?.let { StoreHolder.ingest(ctx, it).housekeeping() }
        } catch (e: Exception) {
          Log.w(TAG, "otp purge failed: ${e.javaClass.simpleName}")
        }
      }, expiresAt - System.currentTimeMillis() + 1_000, TimeUnit.MILLISECONDS)
    }

    fun label(context: Context, pkg: String): String = try {
      val pm = context.packageManager
      pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
      pkg
    }

    fun rebind(context: Context) {
      try {
        NotificationListenerService.requestRebind(ComponentName(context, InflowListener::class.java))
      } catch (e: Exception) {
        Log.w(TAG, "rebind failed: ${e.javaClass.simpleName}")
      }
    }
  }
}
