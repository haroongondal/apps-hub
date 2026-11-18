package expo.modules.inflowcore.android

import android.app.Activity
import android.os.Bundle
import android.widget.Toast

/** No UI. The Run button of a suggestion card starts it, it carries out Run and finishes; an activity (not a receiver) so Android 12+ lets it start Deputy's. */
class SuggestionRunActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val id = intent.getLongExtra(SuggestionNotifier.EXTRA_ID, -1L)
    // A thrown database error must not crash Inflow from a notification tap: the owner gets the plain message instead.
    if (id >= 0) (try { SuggestionNotifier.run(this, id) } catch (e: Exception) { FAILED })?.let { Toast.makeText(applicationContext, it, Toast.LENGTH_LONG).show() }
    finish()
  }

  private companion object {
    const val FAILED = "Inflow couldn't start that. Close and reopen the app, then try again."
  }
}
