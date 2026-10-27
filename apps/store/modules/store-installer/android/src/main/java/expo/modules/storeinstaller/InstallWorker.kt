package expo.modules.storeinstaller

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.coroutines.cancellation.CancellationException

class InstallWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  private val pkg get() = inputData.getString(KEY_PACKAGE).orEmpty()
  private val name get() = inputData.getString(KEY_NAME) ?: pkg

  override suspend fun getForegroundInfo() = foregroundInfo(0, 0)

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    try {
      setForeground(foregroundInfo(0, 0))
    } catch (e: IllegalStateException) {
      // Android 12+ refuses a foreground service started from the background; the job still runs, just killable.
    }
    var percent = -1
    try {
      val file = Installer.download(
        applicationContext, inputData.getString(KEY_URL)!!, pkg,
        inputData.getString(KEY_SHA256)!!, inputData.getString(KEY_CERT)!!,
      ) { done, total ->
        val p = if (total > 0) (done * 100 / total).toInt() else -1
        if (p != percent) {
          percent = p
          setProgressAsync(workDataOf(KEY_DONE to done, KEY_TOTAL to total))
          StoreInstallerModule.emitInstallProgress(mapOf("packageName" to pkg, "bytes" to done.toDouble(), "total" to total.toDouble()))
          notifyProgress(done, total)
        }
      }
      // Committed in the background, Play Protect's prompt goes unseen and aborts after ~17 s, so wait for the user.
      if (!Installer.isForeground()) {
        report("DOWNLOADED", null)
        UpdateCheckWorker.postNotification(applicationContext, pkg.hashCode(), "$name is ready to install", "Open Store and tap Update.")
        return@withContext Result.success()
      }
      Installer.commit(applicationContext, file, pkg, name)
      report("INSTALLING", null)
      Result.success()
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      report("FAILURE_DOWNLOAD", e.message ?: e.javaClass.simpleName)
      if (!Installer.isForeground()) {
        UpdateCheckWorker.postNotification(applicationContext, pkg.hashCode(), "Could not download $name", "Open Store to try again.")
      }
      Result.failure()
    }
  }

  private fun report(status: String, message: String?) = StoreInstallerModule.emitInstallStatus(
    mapOf("packageName" to pkg, "status" to status, "statusCode" to -1, "message" to message),
  )

  private fun notification(done: Long, total: Long) = NotificationCompat.Builder(applicationContext, CHANNEL)
    .setSmallIcon(android.R.drawable.stat_sys_download)
    .setContentTitle("Downloading $name")
    .setOngoing(true)
    .setOnlyAlertOnce(true)
    .setProgress(100, if (total > 0) (done * 100 / total).toInt() else 0, total <= 0)
    .build()

  private fun foregroundInfo(done: Long, total: Long): ForegroundInfo {
    NotificationManagerCompat.from(applicationContext).createNotificationChannel(
      NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_LOW).setName("Downloads").build(),
    )
    val id = pkg.hashCode() + 1
    return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(id, notification(done, total), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else ForegroundInfo(id, notification(done, total))
  }

  @SuppressLint("MissingPermission") // without POST_NOTIFICATIONS Android drops it; the download is unaffected
  private fun notifyProgress(done: Long, total: Long) {
    NotificationManagerCompat.from(applicationContext).notify(pkg.hashCode() + 1, notification(done, total))
  }

  companion object {
    private const val TAG = "store-install"
    private const val CHANNEL = "downloads"
    private const val KEY_PACKAGE = "packageName"
    private const val KEY_NAME = "name"
    private const val KEY_URL = "url"
    private const val KEY_SHA256 = "sha256"
    private const val KEY_CERT = "certSha256"
    private const val KEY_DONE = "bytes"
    private const val KEY_TOTAL = "total"

    fun enqueue(context: Context, url: String, packageName: String, name: String, sha256: String, certSha256: String) {
      val request = OneTimeWorkRequestBuilder<InstallWorker>()
        .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        .setInputData(
          workDataOf(
            KEY_PACKAGE to packageName, KEY_NAME to name, KEY_URL to url, KEY_SHA256 to sha256, KEY_CERT to certSha256,
          ),
        )
        .addTag(TAG)
        .addTag("$TAG:$packageName")
        .build()
      WorkManager.getInstance(context).enqueueUniqueWork("$TAG:$packageName", ExistingWorkPolicy.KEEP, request)
    }

    fun active(context: Context): List<Map<String, Any>> =
      WorkManager.getInstance(context).getWorkInfosByTag(TAG).get().filter { !it.state.isFinished }.mapNotNull { info ->
        val pkg = info.tags.firstOrNull { it.startsWith("$TAG:") }?.removePrefix("$TAG:") ?: return@mapNotNull null
        mapOf(
          "packageName" to pkg,
          "bytes" to info.progress.getLong(KEY_DONE, 0).toDouble(),
          "total" to info.progress.getLong(KEY_TOTAL, -1).toDouble(),
        )
      }
  }
}
