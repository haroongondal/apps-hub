package expo.modules.storeinstaller

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build

class InstallResultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
      confirmIntent(intent)?.let { context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
    StoreInstallerModule.emitInstallStatus(
      mapOf(
        "packageName" to intent.getStringExtra(EXTRA_PACKAGE),
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
