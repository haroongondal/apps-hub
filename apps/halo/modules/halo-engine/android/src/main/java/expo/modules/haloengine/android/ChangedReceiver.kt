package expo.modules.haloengine.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// The ping only says "something changed": anything it carries is ignored, and Halo re-reads the shares, which keep their own guard.
class ChangedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == ACTION) Links.ping(context)
  }

  companion object {
    const val ACTION = "com.haroon.autopilot.CHANGED"
  }
}
