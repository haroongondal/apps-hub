package expo.modules.storeinstaller

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

class UpdateCheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    val (apiUrl, token) = Credentials.load(applicationContext) ?: return@withContext Result.success()
    val body = try {
      val conn = URL("${apiUrl.trimEnd('/')}/manifest.json").openConnection() as HttpURLConnection
      conn.setRequestProperty("Authorization", "Bearer $token")
      try {
        if (conn.responseCode != 200) return@withContext Result.retry()
        conn.inputStream.bufferedReader().readText()
      } finally {
        conn.disconnect()
      }
    } catch (e: IOException) {
      return@withContext Result.retry()
    }
    val outdated = try {
      val apps = JSONObject(body).getJSONArray("apps")
      (0 until apps.length()).map(apps::getJSONObject).mapNotNull { app ->
        val android = app.optJSONObject("android") ?: return@mapNotNull null
        val installed = Packages.installedVersionCode(applicationContext, android.getString("packageName"))
        app.getString("name").takeIf { installed != null && installed < android.getLong("versionCode") }
      }
    } catch (e: org.json.JSONException) {
      return@withContext Result.failure()
    }
    if (outdated.isNotEmpty()) notify(outdated)
    Result.success()
  }

  private fun notify(names: List<String>) = postNotification(
    applicationContext,
    NOTIFICATION_ID,
    if (names.size == 1) "Update available" else "${names.size} updates available",
    names.joinToString(),
  )

  companion object {
    private const val WORK = "store-update-check"
    private const val CHANNEL = "updates"
    private const val NOTIFICATION_ID = 1
    private const val DEFAULT_HOURS = 6

    fun schedule(context: Context, hours: Int) {
      prefs(context).edit().putInt("checkHours", hours).apply()
      val wm = WorkManager.getInstance(context)
      if (hours <= 0) {
        wm.cancelUniqueWork(WORK)
        return
      }
      val request = PeriodicWorkRequestBuilder<UpdateCheckWorker>(hours.toLong(), TimeUnit.HOURS)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build())
        .build()
      wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    fun hours(context: Context) = prefs(context).getInt("checkHours", DEFAULT_HOURS)

    @SuppressLint("MissingPermission")
    fun postNotification(ctx: Context, id: Int, title: String, text: String, tap: PendingIntent? = null) {
      if (Build.VERSION.SDK_INT >= 33 &&
        ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
      ) return
      val nm = NotificationManagerCompat.from(ctx)
      nm.createNotificationChannel(
        NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_DEFAULT).setName("App updates").build(),
      )
      val open = PendingIntent.getActivity(
        ctx, 0, ctx.packageManager.getLaunchIntentForPackage(ctx.packageName), PendingIntent.FLAG_IMMUTABLE,
      )
      val notification = NotificationCompat.Builder(ctx, CHANNEL)
        .setSmallIcon(android.R.drawable.stat_sys_download_done)
        .setContentTitle(title)
        .setContentText(text)
        .setContentIntent(tap ?: open)
        .setAutoCancel(true)
        .build()
      nm.notify(id, notification)
    }
  }
}
