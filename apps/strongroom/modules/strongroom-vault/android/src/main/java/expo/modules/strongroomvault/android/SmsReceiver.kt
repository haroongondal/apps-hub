package expo.modules.strongroomvault.android

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Telephony
import expo.modules.strongroomvault.core.SmsCodes

class SmsReceiver : BroadcastReceiver() {
  // §15.3: only the incoming-message broadcast — MMS and the inbox are never read. A body is
  // read, a code is kept in memory for two minutes, and that is all: nothing here writes to
  // disk, logs, or contacts anything, so it works while the vault is locked (a code is not
  // vault content).
  override fun onReceive(context: Context, intent: Intent) {
    if (context.checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) return
    if (!SmsToggle.on(context)) return
    runCatching {
      for (msg in Telephony.Sms.Intents.getMessagesFromIntent(intent).orEmpty()) {
        val code = msg?.messageBody?.let(SmsCodes::extract) ?: continue
        SmsCodes.put(code, msg.originatingAddress ?: "", System.currentTimeMillis())
        SmsFill.complete(context, code)
      }
    }
  }
}

/** The Settings toggle behind RECEIVE_SMS: requested from the toggle only, never at setup, and off until it is. */
internal object SmsToggle {
  fun on(context: Context): Boolean = VaultHolder.prefs(context).getBoolean(VaultHolder.SMS_FILL, false)
}
