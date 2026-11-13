package expo.modules.inflowcore.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import expo.modules.inflowcore.core.RawSms

class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
    // One long SMS arrives as several PDUs from the same address, in order.
    val messages = parts.filterNotNull().filter { !it.originatingAddress.isNullOrBlank() }.groupBy { it.originatingAddress!! }.map { (address, ps) ->
      RawSms(address, ps.joinToString("") { it.messageBody.orEmpty() }, ps.first().timestampMillis, System.currentTimeMillis())
    }
    val app = context.applicationContext
    val pending = goAsync()
    InflowListener.executor.execute {
      try {
        val store = StoreHolder.get(app).getOrNull()
        if (store == null) {
          Log.w(TAG, "store unavailable, sms dropped")
          return@execute
        }
        val ingest = StoreHolder.ingest(app, store) { InflowListener.schedulePurge(app, it) }
        val pkg = SmsImporter.defaultPkg(app)
        val label = InflowListener.label(app, pkg)
        val saved = store.inTransaction { messages.sumOf { ingest.onSms(it, pkg, label) } }
        if (saved > 0) StoreHolder.onCaptured?.invoke(saved)
      } catch (e: Exception) {
        Log.w(TAG, "sms capture failed: ${e.javaClass.simpleName}")
      } finally {
        pending.finish()
      }
    }
  }

  private companion object {
    const val TAG = "SmsReceiver"
  }
}
