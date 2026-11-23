package expo.modules.clipboardcore

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.ViewTreeObserver
import expo.modules.clipboardcore.android.Bubble
import expo.modules.clipboardcore.android.CaptureService
import expo.modules.clipboardcore.android.ClipStore
import expo.modules.clipboardcore.core.OpenTarget
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

    // The per-service page is a system-only action, so open the list and ask Settings to scroll to and highlight our row.
    Function("openAccessibilitySettings") {
      val ours = ComponentName(context, CaptureService::class.java).flattenToString()
      val args = Bundle().apply { putString(":settings:fragment_args_key", ours) }
      start(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).putExtra(":settings:fragment_args_key", ours).putExtra(":settings:show_fragment_args", args))
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

    Function("setPinned") { id: Long, pinned: Boolean -> ClipStore.get(context).setPinned(id, pinned) }

    Function("getRetentionDays") { ClipStore.get(context).retentionDays() }

    Function("setRetentionDays") { days: Int -> ClipStore.get(context).setRetentionDays(days) }

    Function("copyText") { text: String -> clipboard.setPrimaryClip(ClipData.newPlainText("Clipboard", text)) }

    // Only after a tap on a smart action; the uri is checked again here so nothing but a web page, the dialer or the map opens.
    Function("openAction") { uri: String ->
      val intent = when (OpenTarget.action(uri)) {
        OpenTarget.BROWSE -> Intent(Intent.ACTION_VIEW, Uri.parse(uri)).addCategory(Intent.CATEGORY_BROWSABLE)
        OpenTarget.DIAL -> Intent(Intent.ACTION_DIAL, Uri.parse(uri))
        OpenTarget.VIEW -> Intent(Intent.ACTION_VIEW, Uri.parse(uri))
        else -> return@Function false
      }
      runCatching { start(intent) }.isSuccess
    }

    Function("clearAll") { ClipStore.get(context).clearAll() }

    Function("setPalettes") { json: String -> Bubble.savePalettes(context, json) }
  }

  private fun start(intent: Intent) {
    val activity = appContext.currentActivity
    if (activity != null) activity.startActivity(intent) else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  private fun captureFocused() {
    if (ClipStore.get(context).capture(context.contentResolver, clipboard.primaryClip, null, "app", null)) {
      ClipStore.onAdded?.invoke()
    }
  }
}
