package expo.modules.notchisland.android

import android.accessibilityservice.AccessibilityService
import android.animation.ValueAnimator
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.FrameLayout
import android.widget.LinearLayout
import expo.modules.notchisland.core.Cutout
import expo.modules.notchisland.core.NotchSettings
import expo.modules.notchisland.core.PillBox
import expo.modules.notchisland.core.PillGeometry

// An accessibility overlay, unlike TYPE_APPLICATION_OVERLAY, sits above the status bar, so HyperOS lets the pill take touches there. The service reads no events and no screen content.
class NotchAccessibilityService : AccessibilityService() {
  private val main = Handler(Looper.getMainLooper())
  private var wm: WindowManager? = null
  private var pill: FrameLayout? = null
  private var card: LinearLayout? = null
  private var header: HeaderView? = null
  private var battery: BatteryView? = null
  private var params: WindowManager.LayoutParams? = null
  private var animator: ValueAnimator? = null
  private var open = false
  private var settings = NotchSettings.DEFAULTS
  private var small = PillBox(0, 0, 0)
  private var big = PillBox(0, 0, 0)
  private var events: BroadcastReceiver? = null
  private val collapse = Runnable { setOpen(false) }

  override fun onServiceConnected() {
    running = true
    instance = this
    show()
    registerEvents()
  }

  override fun onUnbind(intent: Intent?): Boolean {
    running = false
    instance = null
    unregisterEvents()
    remove()
    return super.onUnbind(intent)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    reapply()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  override fun onInterrupt() = Unit

  fun reapply() {
    main.post {
      remove()
      show()
    }
  }

  private fun cutout(manager: WindowManager): Cutout? {
    if (Build.VERSION.SDK_INT < 30) return null
    val r = manager.currentWindowMetrics.windowInsets.displayCutout?.boundingRectTop ?: return null
    return if (r.isEmpty) null else Cutout(r.left, r.right, r.bottom)
  }

  private fun show() {
    settings = NotchPrefs.load(this)
    val manager = getSystemService(WindowManager::class.java)
    val density = resources.displayMetrics.density
    val screenW = resources.displayMetrics.widthPixels
    val scale = PillGeometry.sizeScale(settings.size)
    val hole = cutout(manager)
    small = scaled(PillGeometry.collapsed(hole, screenW, density), scale, screenW, density)
    big = scaled(PillGeometry.expanded(hole, screenW, density), scale, screenW, density)

    val content = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      alpha = if (open) 1f else 0f
    }
    header = null
    battery = null
    for (id in settings.widgets) {
      when (id) {
        "clock" -> HeaderView(this).also { header = it; content.addView(it) }
        "battery" -> BatteryView(this).also { battery = it; content.addView(it) }
      }
    }
    header?.bind(settings)
    refreshBattery()
    card = content

    val view = FrameLayout(this).apply {
      background = GradientDrawable().apply { setColor(Colours.pill(settings.pill, settings.accent)) }
      contentDescription = "Notch"
      setOnClickListener { setOpen(!open) }
      addView(content, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT).apply { topMargin = small.height })
    }
    val box = if (open) big else small
    val lp = WindowManager.LayoutParams(
      box.width,
      box.height,
      WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      x = box.xFromCenter
      if (Build.VERSION.SDK_INT >= 28) layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }
    if (runCatching { manager.addView(view, lp) }.isFailure) return
    wm = manager
    pill = view
    params = lp
    corners(box)
  }

  private fun scaled(box: PillBox, scale: Float, screenW: Int, density: Float): PillBox =
    box.copy(width = minOf((box.width * scale).toInt(), screenW - (32 * density).toInt()))

  private fun remove() {
    main.removeCallbacks(collapse)
    animator?.cancel()
    pill?.let { v -> runCatching { wm?.removeView(v) } }
    pill = null
    card = null
    header = null
    battery = null
  }

  private fun corners(box: PillBox) {
    val density = resources.displayMetrics.density
    val radius = when (settings.corners) {
      "squared" -> 6 * density
      "rounded" -> 28 * density
      else -> box.height / 2f
    }
    (pill?.background as? GradientDrawable)?.cornerRadius = radius
  }

  private fun refreshBattery() {
    val intent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return
    val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
    val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
    if (level < 0 || scale <= 0) return
    val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
    val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
    battery?.bind(level * 100 / scale, charging, Colours.accent(settings.accent))
  }

  private fun setOpen(next: Boolean, holdMs: Long? = PillGeometry.foldDelayMs(settings.foldMs)) {
    val view = pill ?: return
    val lp = params ?: return
    main.removeCallbacks(collapse)
    if (next && holdMs != null) main.postDelayed(collapse, holdMs)
    if (next == open) return
    open = next
    if (next) {
      header?.bind(settings)
      refreshBattery()
    }
    animator?.cancel()
    val from = PillBox(lp.x, lp.width, lp.height)
    val to = if (next) big else small
    val c = card
    animator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 220
      addUpdateListener {
        val t = it.animatedValue as Float
        val box = PillGeometry.lerp(from, to, t)
        lp.x = box.xFromCenter
        lp.width = box.width
        lp.height = box.height
        corners(box)
        c?.alpha = if (next) t else 1f - t
        runCatching { wm?.updateViewLayout(view, lp) }
      }
      start()
    }
  }

  private fun registerEvents() {
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
          Intent.ACTION_POWER_CONNECTED -> setOpen(true, CHARGE_OPEN_MS)
          Intent.ACTION_TIME_TICK -> if (open) header?.bind(settings)
          Intent.ACTION_BATTERY_CHANGED -> if (open) refreshBattery()
        }
      }
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_POWER_CONNECTED)
      addAction(Intent.ACTION_TIME_TICK)
      addAction(Intent.ACTION_BATTERY_CHANGED)
    }
    events = receiver
    // The three actions are system broadcasts, so an exported receiver is safe; the flag exists only from Android 13.
    if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    else registerReceiver(receiver, filter)
  }

  private fun unregisterEvents() {
    events?.let { runCatching { unregisterReceiver(it) } }
    events = null
  }

  companion object {
    private const val CHARGE_OPEN_MS = 3000L

    @Volatile var running = false
      private set

    @Volatile var instance: NotchAccessibilityService? = null
      private set
  }
}
