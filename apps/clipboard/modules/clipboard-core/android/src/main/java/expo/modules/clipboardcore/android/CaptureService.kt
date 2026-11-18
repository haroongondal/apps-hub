package expo.modules.clipboardcore.android

import android.accessibilityservice.AccessibilityService
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo
import expo.modules.clipboardcore.core.CopySignal

private const val TAG = "ClipCapture"
private const val TRIGGER_DELAY_MS = 150L
private val RETRY_MS = listOf(300L, 600L, 1000L)
private const val GIVE_UP_MS = 1500L
private val NOT_FOREGROUND = setOf("android", "com.android.systemui", "com.google.android.inputmethod.latin")
private val DIGIT = Regex("""\d""")

class CaptureService : AccessibilityService() {
  private val main = Handler(Looper.getMainLooper())
  private var grabbing = false
  private var foreground: String? = null

  override fun onServiceConnected() {
    connected = true
  }

  override fun onUnbind(intent: Intent?): Boolean {
    connected = false
    Bubble.hide()
    return super.onUnbind(intent)
  }

  override fun onInterrupt() = Unit

  override fun onAccessibilityEvent(e: AccessibilityEvent) {
    if (e.eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED || e.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
      val keyboard = runCatching { windows }.getOrNull()?.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }
      Bubble.update(this, keyboard?.let { Rect().also(it::getBoundsInScreen).top })
      if (e.eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED) return
    }
    val pkg = e.packageName?.toString()
    val text = "${e.text} ${e.contentDescription ?: ""}"
    val type = AccessibilityEvent.eventTypeToString(e.eventType)
    if (e.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && pkg != null && pkg != packageName && pkg !in NOT_FOREGROUND) {
      foreground = pkg
    }
    val copy = CopySignal.isCopy(e.eventType, pkg, text, packageName)
    // shortcut: spike S3 logging (masked copy/clipboard wording only), delete once HyperOS's signals are known.
    Log.i(TAG, "$type pkg=$pkg cls=${e.className} copy=$copy" + if (CopySignal.loggable(text)) " text=${text.take(60).replace(DIGIT, "#")}" else "")
    if (copy && !grabbing) {
      val source = if (e.eventType == AccessibilityEvent.TYPE_VIEW_CLICKED) pkg else foreground
      main.postDelayed({ grab(type, source) }, TRIGGER_DELAY_MS)
    }
  }

  private fun grab(via: String, source: String?) {
    if (grabbing) return
    val wm = getSystemService(WindowManager::class.java)
    val cm = getSystemService(ClipboardManager::class.java)
    val t0 = SystemClock.uptimeMillis()
    val view = View(this)
    var done = false

    // Only the focused app may read the clipboard, and the focus callback sometimes never arrives even though the read works, so timers retry too.
    fun attempt(last: Boolean) {
      if (done) return
      val clip = runCatching { cm.primaryClip }.getOrNull()
      if (clip == null && !last) return
      done = true
      runCatching { wm.removeView(view) }
      grabbing = false
      val ms = SystemClock.uptimeMillis() - t0
      val saved = clip != null && ClipStore.get(this).capture(contentResolver, clip, source, via, ms)
      Log.i(TAG, "grab via=$via ms=$ms read=${clip != null} saved=$saved")
      if (saved) ClipStore.onAdded?.invoke()
    }

    view.viewTreeObserver.addOnWindowFocusChangeListener { has -> if (has) attempt(false) }
    val lp = WindowManager.LayoutParams(
      1, 1,
      WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
      PixelFormat.TRANSPARENT,
    ).apply { gravity = Gravity.TOP or Gravity.START }
    if (runCatching { wm.addView(view, lp) }.isFailure) return
    grabbing = true
    RETRY_MS.forEach { main.postDelayed({ attempt(false) }, it) }
    main.postDelayed({ attempt(true) }, GIVE_UP_MS)
  }

  companion object {
    @Volatile var connected = false
      private set
  }
}
