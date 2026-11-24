package expo.modules.deputyagent.android

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import expo.modules.deputyagent.core.SharedInbox
import expo.modules.deputyagent.core.SharedText

/** The share sheet's target for text: it hands the cleaned text to Deputy's "New task from shared text" screen and opens it. */
class ShareActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {
      // Another app built these extras; a bad parcel must not crash Deputy.
      val shared = runCatching {
        SharedText.from(intent.action, intent.type, intent.getCharSequenceExtra(Intent.EXTRA_TEXT), intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT))
      }.getOrNull()
      val open = packageManager.getLaunchIntentForPackage(packageName)
      if (shared == null || open == null) {
        Toast.makeText(applicationContext, "Deputy can only take shared text or a link.", Toast.LENGTH_LONG).show()
        return
      }
      SharedInbox.put(shared)
      startActivity(open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } finally {
      finish()
    }
  }
}
