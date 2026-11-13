package expo.modules.noteboxcore.android

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import java.util.concurrent.Executors
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
      val saved = StoreHolder.ingest(applicationContext, store).onNotification(RawFromSbn.from(sbn, label(sbn.packageName)))
      store.setMeta(LAST_CAPTURE_AT, System.currentTimeMillis().toString())
      if (saved > 0) StoreHolder.onCaptured?.invoke(saved)
    } catch (e: Exception) {
      Log.w(TAG, "capture failed: ${e.javaClass.simpleName}")
    }
  }

  private fun label(pkg: String): String = try {
    packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
  } catch (e: PackageManager.NameNotFoundException) {
    pkg
  }

  companion object {
    const val LAST_CAPTURE_AT = "lastCaptureAt"
    private const val TAG = "NoteboxListener"
    val connected = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "notebox-capture").apply { isDaemon = true } }

    fun rebind(context: Context) {
      try {
        NotificationListenerService.requestRebind(ComponentName(context, NoteboxListener::class.java))
      } catch (e: Exception) {
        Log.w(TAG, "rebind failed: ${e.javaClass.simpleName}")
      }
    }
  }
}
