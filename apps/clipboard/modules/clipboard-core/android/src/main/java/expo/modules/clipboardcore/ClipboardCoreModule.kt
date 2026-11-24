package expo.modules.clipboardcore

import android.app.Activity
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
import expo.modules.clipboardcore.applink.AppLinkTarget
import expo.modules.clipboardcore.core.InflowTodo
import expo.modules.clipboardcore.core.OpenTarget
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicReference

private const val CLIP_EVENT = "onClip"

class ClipboardCoreModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  private val clipboard: ClipboardManager
    get() = context.getSystemService(ClipboardManager::class.java)

  // The one open ADD_TODO hand-off; getAndSet(null) settles its promise exactly once.
  private val inflowPromise = AtomicReference<Promise?>(null)

  override fun definition() = ModuleDefinition {
    Name("ClipboardCore")

    Events(CLIP_EVENT)

    OnCreate {
      ClipStore.onAdded = { sendEvent(CLIP_EVENT, emptyMap<String, Any>()) }
      appContext.reactContext?.let { runCatching { ClipStore.get(it).heartbeat() } }
    }

    OnDestroy {
      ClipStore.onAdded = null
      inflowPromise.getAndSet(null)?.resolve("cancelled")
    }

    Function("getServiceState") { mapOf("enabled" to CaptureService.isEnabled(context), "connected" to CaptureService.connected) }

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

    Function("getNexusReadsPinned") { ClipStore.get(context).nexusReadsPinned() }

    Function("setNexusReadsPinned") { on: Boolean -> ClipStore.get(context).setNexusReadsPinned(on) }

    // startActivityForResult from the open screen is what lets Inflow check who is asking; Inflow saves only after the owner taps Add there.
    AsyncFunction("addToInflow") { title: String, note: String, source: String, promise: Promise ->
      val extras = InflowTodo.extras(title, note, source)
      val activity = appContext.currentActivity
      when {
        extras == null || activity == null -> promise.resolve("refused")
        !inflowPromise.compareAndSet(null, promise) -> promise.resolve("busy")
        else -> {
          val intent = Intent(InflowTodo.ACTION).setPackage(InflowTodo.INFLOW_PACKAGE)
          extras.forEach { (key, value) -> (value as? String)?.let { intent.putExtra(key, it) } }
          val failed = InflowTodo.launch(AppLinkTarget.trustedActivity(activity, intent)) {
            activity.startActivityForResult(intent, InflowTodo.REQUEST_CODE)
          }
          if (failed != null) inflowPromise.getAndSet(null)?.resolve(failed)
        }
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != InflowTodo.REQUEST_CODE) return@OnActivityResult
      inflowPromise.getAndSet(null)?.resolve(InflowTodo.outcome(payload.resultCode == Activity.RESULT_OK, payload.data?.getStringExtra("code")))
    }
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
