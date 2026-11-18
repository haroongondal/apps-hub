package expo.modules.inflowcore.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Fires at the time a bill reminder was set for and posts its silent card. */
class SuggestionReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val title = intent.getStringExtra(SuggestionNotifier.EXTRA_TITLE) ?: return
    SuggestionNotifier.remindNow(context.applicationContext, intent.getLongExtra(SuggestionNotifier.EXTRA_ID, 0L), title, intent.getStringExtra(SuggestionNotifier.EXTRA_PKG))
  }
}
