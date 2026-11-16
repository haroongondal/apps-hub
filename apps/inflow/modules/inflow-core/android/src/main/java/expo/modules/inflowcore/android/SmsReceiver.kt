package expo.modules.inflowcore.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import java.util.concurrent.TimeUnit

/**
 * Only a wake-up. Every SMS item comes from a provider row (SmsImporter), so one message has one identity: the default SMS app
 * writes that row asynchronously, hence two inbox syncs a little after the broadcast; a row it writes later waits for the next sync.
 */
class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    val app = context.applicationContext
    for (delay in SYNC_DELAYS_S) {
      InflowListener.executor.schedule({
        try {
          val saved = SmsImporter.sync(app)
          if (saved > 0) StoreHolder.onCaptured?.invoke(saved)
        } catch (e: Exception) {
          Log.w(TAG, "sms sync failed: ${e.javaClass.simpleName}")
        }
      }, delay, TimeUnit.SECONDS)
    }
  }

  private companion object {
    const val TAG = "SmsReceiver"
    val SYNC_DELAYS_S = listOf(3L, 30L)
  }
}
