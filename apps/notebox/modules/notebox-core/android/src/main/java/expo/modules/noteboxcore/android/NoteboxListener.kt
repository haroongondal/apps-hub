package expo.modules.noteboxcore.android

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class NoteboxListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val posted = sbn ?: return
    executor.execute { capture(posted) }
  }

  override fun onNotificationRemoved(sbn: StatusBarNotification?) = Unit

  override fun onListenerConnected() {
    connected.set(true)
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
      val saved = StoreHolder.ingest(applicationContext, store, ::schedulePurge)
        .onNotification(RawFromSbn.from(sbn, label(applicationContext, sbn.packageName)))
      store.setMeta(LAST_CAPTURE_AT, System.currentTimeMillis().toString())
      if (saved > 0) StoreHolder.onCaptured?.invoke(saved)
    } catch (e: Exception) {
      Log.w(TAG, "capture failed: ${e.javaClass.simpleName}")
    }
  }

  // shortcut: an in-process timer dies with the process; then the OTP stays hidden and is purged on the next
  // notification or when Home opens. Use AlarmManager if the phone check shows HyperOS kills the listener often.
  private fun schedulePurge(expiresAt: Long) {
    val ctx = applicationContext
    executor.schedule({
      try {
        StoreHolder.get(ctx).getOrNull()?.let { StoreHolder.ingest(ctx, it).housekeeping() }
      } catch (e: Exception) {
        Log.w(TAG, "otp purge failed: ${e.javaClass.simpleName}")
      }
    }, expiresAt - System.currentTimeMillis() + 1_000, TimeUnit.MILLISECONDS)
  }

  companion object {
    const val LAST_CAPTURE_AT = "lastCaptureAt"
    private const val TAG = "NoteboxListener"
    val connected = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "notebox-capture").apply { isDaemon = true } }

    fun label(context: Context, pkg: String): String = try {
      val pm = context.packageManager
      pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
      pkg
    }

    fun rebind(context: Context) {
      try {
        NotificationListenerService.requestRebind(ComponentName(context, NoteboxListener::class.java))
      } catch (e: Exception) {
        Log.w(TAG, "rebind failed: ${e.javaClass.simpleName}")
      }
    }
  }
}
