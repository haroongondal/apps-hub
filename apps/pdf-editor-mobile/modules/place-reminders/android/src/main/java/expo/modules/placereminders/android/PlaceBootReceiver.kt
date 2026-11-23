package expo.modules.placereminders.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class PlaceBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED) PlaceAlerts.restore(context)
  }
}
