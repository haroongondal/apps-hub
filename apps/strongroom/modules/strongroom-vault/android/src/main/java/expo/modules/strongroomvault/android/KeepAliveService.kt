package expo.modules.strongroomvault.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * A foreground service that keeps the process alive so Android can rebind to [StrongroomAutofillService] promptly.
 *
 * Why: the system unbinds an idle autofill service five seconds after it answers, so every fill after a quiet
 * moment is a fresh bind. A fresh bind into a cached-and-frozen process works on stock Android but can stall
 * in "binding, never connected" on HyperOS until the request times out. A foreground process can't be frozen.
 */
class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Autofill keep-alive", NotificationManager.IMPORTANCE_LOW))
    }
    val note = Notification.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
      .setContentTitle("Strongroom autofill")
      .setContentText("Ready to fill passwords.")
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      // Low importance keeps it silent but visible, so the ongoing status icon matches the Settings copy.
      startForeground(ID, note)
    }
  }

  companion object {
    private const val CHANNEL = "keepAlive"
    private const val ID = 1

    // A start is a privilege the system may refuse, never a guarantee; an unlock must not fail over it.
    internal fun start(context: Context) {
      if (!VaultHolder.prefs(context).getBoolean(VaultHolder.KEEP_ALIVE, true)) return
      val intent = Intent(context, KeepAliveService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      } catch (e: Exception) {
        // The next unlock starts it again; nothing here must ever make an unlock fail.
      }
    }

    internal fun stop(context: Context) {
      context.stopService(Intent(context, KeepAliveService::class.java))
    }
  }
}
