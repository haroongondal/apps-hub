package expo.modules.audiochunks.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

// Keeps the app's process and its microphone access alive while a meeting records with the screen off.
class MeetingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTICE_ID, notice(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(NOTICE_ID, notice())
      }
    } catch (e: Exception) {
      MeetingRecorder.stop("Android did not let Nexus keep recording in the background.")
    }
    if (!MeetingRecorder.isRecording) stopSelf()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    MeetingRecorder.stop("Android stopped the recording.")
    super.onDestroy()
  }

  private fun notice() = run {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Meeting recording", NotificationManager.IMPORTANCE_LOW))
    }
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("pdfeditor://meeting")).setPackage(packageName)
    NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentTitle("Recording a meeting")
      .setContentText("Tap to open Nexus and stop it.")
      .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
      .setOngoing(true)
      .setUsesChronometer(true)
      .setWhen(System.currentTimeMillis() - (MeetingRecorder.status()["elapsedMs"] as Double).toLong())
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  companion object {
    private const val CHANNEL = "meeting-recording"
    private const val NOTICE_ID = 4_201

    fun start(context: Context) {
      val intent = Intent(context, MeetingService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, MeetingService::class.java))
    }
  }
}
