package expo.modules.storeinstaller

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build

class InstallResultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    val pkg = intent.getStringExtra(EXTRA_PACKAGE)
    val name = intent.getStringExtra(EXTRA_NAME) ?: pkg
    val foreground = Installer.isForeground()
    when (status) {
      PackageInstaller.STATUS_SUCCESS -> Installer.clearDownloads(context)
      PackageInstaller.STATUS_PENDING_USER_ACTION -> confirmIntent(intent)?.let {
        it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // Android blocks starting an activity from the background, so hand the prompt to a notification instead.
        if (foreground) context.startActivity(it)
        else UpdateCheckWorker.postNotification(
          context, pkg.hashCode(), "Finish installing $name", "Tap to confirm the install.",
          PendingIntent.getActivity(context, pkg.hashCode(), it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
        )
      }
      PackageInstaller.STATUS_FAILURE_ABORTED -> if (!foreground) {
        UpdateCheckWorker.postNotification(context, pkg.hashCode(), "$name was not installed", "Open Store and tap Update to try again.")
      }
    }
    StoreInstallerModule.emitInstallStatus(
      mapOf(
        "packageName" to pkg,
        "status" to statusName(status),
        "statusCode" to status,
        "message" to intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE),
      ),
    )
  }

  @Suppress("DEPRECATION")
  private fun confirmIntent(intent: Intent): Intent? =
    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
    else intent.getParcelableExtra(Intent.EXTRA_INTENT)

  private fun statusName(status: Int) = when (status) {
    PackageInstaller.STATUS_SUCCESS -> "SUCCESS"
    PackageInstaller.STATUS_PENDING_USER_ACTION -> "PENDING_USER_ACTION"
    PackageInstaller.STATUS_FAILURE_ABORTED -> "FAILURE_ABORTED"
    PackageInstaller.STATUS_FAILURE_BLOCKED -> "FAILURE_BLOCKED"
    PackageInstaller.STATUS_FAILURE_CONFLICT -> "FAILURE_CONFLICT"
    PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "FAILURE_INCOMPATIBLE"
    PackageInstaller.STATUS_FAILURE_INVALID -> "FAILURE_INVALID"
    PackageInstaller.STATUS_FAILURE_STORAGE -> "FAILURE_STORAGE"
    8 -> "FAILURE_TIMEOUT" // PackageInstaller.STATUS_FAILURE_TIMEOUT, API 34
    else -> "FAILURE"
  }
}
