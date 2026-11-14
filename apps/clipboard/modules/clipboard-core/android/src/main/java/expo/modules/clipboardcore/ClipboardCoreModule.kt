package expo.modules.clipboardcore

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.ViewTreeObserver
import expo.modules.clipboardcore.android.Bubble
import expo.modules.clipboardcore.android.CaptureService
import expo.modules.clipboardcore.android.ClipStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val CLIP_EVENT = "onClip"

class ClipboardCoreModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  private val clipboard: ClipboardManager
    get() = context.getSystemService(ClipboardManager::class.java)

  override fun definition() = ModuleDefinition {
    Name("ClipboardCore")

    Events(CLIP_EVENT)

    OnCreate { ClipStore.onAdded = { sendEvent(CLIP_EVENT, emptyMap<String, Any>()) } }

    OnDestroy { ClipStore.onAdded = null }

    Function("getServiceState") {
      val ours = ComponentName(context, CaptureService::class.java)
      val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
        ?.split(':')?.any { ComponentName.unflattenFromString(it) == ours } == true
      mapOf("enabled" to enabled, "connected" to CaptureService.connected)
    }

    Function("openAccessibilitySettings") {
      context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    Function("captureNow") {
      val view = appContext.currentActivity?.window?.decorView ?: return@Function null
      view.post {
        // Android refuses the read until the window has focus, which arrives after the app reports active.
        if (view.hasWindowFocus()) return@post captureFocused()
        view.viewTreeObserver.addOnWindowFocusChangeListener(object : ViewTreeObserver.OnWindowFocusChangeListener {
          override fun onWindowFocusChanged(hasFocus: Boolean) {
            if (!hasFocus) return
            view.viewTreeObserver.removeOnWindowFocusChangeListener(this)
            captureFocused()
          }
        })
      }
      null
    }

    Function("recent") { limit: Int -> ClipStore.get(context).recent(limit).map { it.toMap() } }

    Function("copy") { id: Long ->
      val text = ClipStore.get(context).reuse(id) ?: return@Function false
      clipboard.setPrimaryClip(ClipData.newPlainText("Clipboard", text))
      true
    }

    Function("remove") { id: Long -> ClipStore.get(context).remove(id) }

    Function("setPalettes") { json: String -> Bubble.savePalettes(context, json) }
  }

  private fun captureFocused() {
    if (ClipStore.get(context).capture(context.contentResolver, clipboard.primaryClip, null, "app", null)) {
      ClipStore.onAdded?.invoke()
    }
  }
}
