package expo.modules.storeinstaller

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.pm.PackageInfoCompat

// Android kills the Store to replace it and won't let a background receiver reopen it, so say it's done.
class SelfUpdateReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    val version = "${info.versionName} (${PackageInfoCompat.getLongVersionCode(info)})"
    UpdateCheckWorker.postNotification(context, NOTIFICATION_ID, "Store updated to $version", "Tap to open Store.")
  }

  private companion object {
    const val NOTIFICATION_ID = 2
  }
}
