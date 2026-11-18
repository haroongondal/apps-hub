package expo.modules.inflowcore.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import expo.modules.inflowcore.core.SuggestionMoves
import expo.modules.inflowcore.core.SuggestionState

/** The Skip button of a suggestion card: moves it to skipped and clears the card. */
class SuggestionSkipReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getLongExtra(SuggestionNotifier.EXTRA_ID, -1L)
    if (id < 0) return
    val app = context.applicationContext
    SuggestionNotifier.cancel(app, id)
    val pending = goAsync()
    InflowListener.executor.execute {
      try {
        StoreHolder.get(app).getOrNull()?.let { SuggestionMoves.move(SqlSuggestionStore(it.db), id, SuggestionState.SKIPPED, System.currentTimeMillis()) }
      } catch (e: Exception) {
        Log.w("SuggestionSkip", "skip failed: ${e.javaClass.simpleName}")
      } finally {
        pending.finish()
      }
    }
  }
}
