package expo.modules.haloengine.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder
import android.app.Notification

/** Foreground service for the stage 1 spike. Which FGS type survives which start path is what the probes measure. */
class HaloService : Service() {
  private var tap: AudioTap? = null
  private var overlay: EdgeOverlay? = null
  private var screenOff: BroadcastReceiver? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val type = intent?.getIntExtra(EXTRA_TYPE, MEDIA_PLAYBACK) ?: MEDIA_PLAYBACK
    val path = intent?.getStringExtra(EXTRA_PATH) ?: "restart"
    ProbeLog.log(this, "service", "onStartCommand path=$path type=${typeName(type)} sdk=${Build.VERSION.SDK_INT} alreadyRunning=$running")
    try {
      startForeground(NOTIFICATION_ID, notification(), type)
      ProbeLog.log(this, "service", "startForeground ok path=$path type=${typeName(type)}")
    } catch (e: Exception) {
      ProbeLog.log(this, "service", "startForeground FAILED path=$path type=${typeName(type)} ${e.javaClass.name}: ${e.message}")
      stopSelf()
      return START_NOT_STICKY
    }
    if (running) return START_NOT_STICKY
    running = true
    ProbeLog.log(this, "service", "notificationsEnabled=${getSystemService(NotificationManager::class.java).areNotificationsEnabled()}")
    overlay = EdgeOverlay(this).also { it.add() }
    tap = AudioTap(this, { overlay?.setLevel(it) }, ::publish).also { it.start() }
    registerScreenOff()
    publish()
    return START_NOT_STICKY
  }

  private fun publish() {
    audio = tap?.status ?: "idle"
    onChange?.invoke()
  }

  private fun registerScreenOff() {
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context, i: Intent) {
        ProbeLog.log(context, "aod", "SCREEN_OFF received, launching AodActivity")
        try {
          context.startActivity(Intent(context, AodActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          ProbeLog.log(context, "aod", "startActivity returned without exception")
        } catch (e: Exception) {
          ProbeLog.log(context, "aod", "launch FAILED ${e.javaClass.name}: ${e.message}")
        }
      }
    }
    registerReceiver(r, IntentFilter(Intent.ACTION_SCREEN_OFF), Context.RECEIVER_NOT_EXPORTED)
    screenOff = r
  }

  private fun notification(): Notification {
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CHANNEL, "Halo", NotificationManager.IMPORTANCE_LOW))
    return Notification.Builder(this, CHANNEL)
      .setSmallIcon(Icon.createWithResource(this, applicationInfo.icon))
      .setContentTitle("Halo is running")
      .setOngoing(true)
      .build()
  }

  override fun onDestroy() {
    screenOff?.let { runCatching { unregisterReceiver(it) } }
    screenOff = null
    tap?.stop()
    tap = null
    overlay?.remove()
    overlay = null
    running = false
    ProbeLog.log(this, "service", "destroyed")
    publish()
  }

  companion object {
    const val MEDIA_PLAYBACK = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    const val SPECIAL_USE = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
    private const val EXTRA_TYPE = "type"
    private const val EXTRA_PATH = "path"
    private const val CHANNEL = "halo_running"
    private const val NOTIFICATION_ID = 7001

    @Volatile var running = false
      private set
    @Volatile var onChange: (() -> Unit)? = null

    /** "ok", "blocked" or "idle"; idle whenever the service is not running. */
    @Volatile var audio = "idle"
      private set

    fun typeName(type: Int) = when (type) {
      MEDIA_PLAYBACK -> "mediaPlayback"
      SPECIAL_USE -> "specialUse"
      else -> "type$type"
    }

    /** Every start path goes through here so its outcome, success or exception, lands in the probe log. */
    fun start(ctx: Context, type: Int, path: String) {
      try {
        ctx.startForegroundService(Intent(ctx, HaloService::class.java).putExtra(EXTRA_TYPE, type).putExtra(EXTRA_PATH, path))
        ProbeLog.log(ctx, "start", "startForegroundService accepted path=$path type=${typeName(type)}")
      } catch (e: Exception) {
        ProbeLog.log(ctx, "start", "startForegroundService FAILED path=$path type=${typeName(type)} ${e.javaClass.name}: ${e.message}")
      }
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, HaloService::class.java))
    }
  }
}
