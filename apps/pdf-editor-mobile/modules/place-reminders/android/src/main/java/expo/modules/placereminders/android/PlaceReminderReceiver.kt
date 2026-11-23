package expo.modules.placereminders.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import expo.modules.placereminders.core.shouldNotify

/** Receives the system's proximity events for one reminder and posts its notification when the trigger matches. */
class PlaceReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (!intent.hasExtra(LocationManager.KEY_PROXIMITY_ENTERING)) return
    val entering = intent.getBooleanExtra(LocationManager.KEY_PROXIMITY_ENTERING, false)
    val trigger = intent.getStringExtra(EXTRA_TRIGGER) ?: return
    if (!shouldNotify(trigger, entering)) return
    val itemId = intent.getStringExtra(EXTRA_ITEM_ID) ?: return
    Notices.post(context, itemId, intent.getStringExtra(EXTRA_TITLE) ?: "A saved place")
  }
}
