package expo.modules.notchisland.android

import android.accessibilityservice.AccessibilityService
import android.animation.ValueAnimator
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.FrameLayout
import android.widget.TextClock
import expo.modules.notchisland.core.Cutout
import expo.modules.notchisland.core.PillBox
import expo.modules.notchisland.core.PillGeometry

// An accessibility overlay, unlike TYPE_APPLICATION_OVERLAY, sits above the status bar, so HyperOS lets the pill take touches there. The service reads no events and no screen content.
class NotchAccessibilityService : AccessibilityService() {
  private val main = Handler(Looper.getMainLooper())
  private var wm: WindowManager? = null
  private var pill: FrameLayout? = null
  private var params: WindowManager.LayoutParams? = null
  private var animator: ValueAnimator? = null
  private var open = false
  private var small = PillBox(0, 0, 0)
  private var big = PillBox(0, 0, 0)
  private val collapse = Runnable { setOpen(false) }

  override fun onServiceConnected() {
    running = true
    instance = this
    show()
  }

  override fun onUnbind(intent: Intent?): Boolean {
    running = false
    instance = null
    remove()
    return super.onUnbind(intent)
  }

  /** Rebuilds the pill from the saved settings; the card is rebuilt in phase 1's Task 7. */
  fun reapply() {
    main.post {
      remove()
      show()
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    remove()
    show()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  override fun onInterrupt() = Unit

  private fun cutout(manager: WindowManager): Cutout? {
    if (Build.VERSION.SDK_INT < 30) return null
    val r = manager.currentWindowMetrics.windowInsets.displayCutout?.boundingRectTop ?: return null
    return if (r.isEmpty) null else Cutout(r.left, r.right, r.bottom)
  }

  private fun show() {
    val manager = getSystemService(WindowManager::class.java)
    val density = resources.displayMetrics.density
    val screenW = resources.displayMetrics.widthPixels
    val hole = cutout(manager)
    small = PillGeometry.collapsed(hole, screenW, density)
    big = PillGeometry.expanded(hole, screenW, density)
    open = false
    val clock = TextClock(this).apply {
      format12Hour = "h:mm"
      format24Hour = "HH:mm"
      textSize = 28f
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
      alpha = 0f
    }
    val view = FrameLayout(this).apply {
      background = GradientDrawable().apply { setColor(Color.BLACK) }
      contentDescription = "Notch"
      setOnClickListener { setOpen(!open) }
      addView(clock, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT).apply { topMargin = small.height })
    }
    val lp = WindowManager.LayoutParams(
      small.width,
      small.height,
      WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      x = small.xFromCenter
      if (Build.VERSION.SDK_INT >= 28) layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }
    if (runCatching { manager.addView(view, lp) }.isFailure) return
    wm = manager
    pill = view
    params = lp
    corners(small)
  }

  private fun remove() {
    main.removeCallbacks(collapse)
    animator?.cancel()
    pill?.let { v -> runCatching { wm?.removeView(v) } }
    pill = null
  }

  private fun corners(box: PillBox) {
    (pill?.background as? GradientDrawable)?.cornerRadius = minOf(box.height / 2f, 28 * resources.displayMetrics.density)
  }

  private fun setOpen(next: Boolean) {
    val view = pill ?: return
    val lp = params ?: return
    if (next == open) return
    open = next
    main.removeCallbacks(collapse)
    if (next) main.postDelayed(collapse, AUTO_COLLAPSE_MS)
    animator?.cancel()
    val from = PillBox(lp.x, lp.width, lp.height)
    val to = if (next) big else small
    animator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 220
      addUpdateListener {
        val t = it.animatedValue as Float
        val box = PillGeometry.lerp(from, to, t)
        lp.x = box.xFromCenter
        lp.width = box.width
        lp.height = box.height
        corners(box)
        view.getChildAt(0).alpha = if (next) t else 1f - t
        runCatching { wm?.updateViewLayout(view, lp) }
      }
      start()
    }
  }

  companion object {
    private const val AUTO_COLLAPSE_MS = 4000L

    @Volatile var running = false
      private set

    @Volatile var instance: NotchAccessibilityService? = null
      private set
  }
}
