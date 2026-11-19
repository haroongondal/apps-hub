package expo.modules.notchisland.android

import android.accessibilityservice.AccessibilityService
import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.app.Notification
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
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.TextView
import expo.modules.notchisland.core.Cutout
import expo.modules.notchisland.core.NotchSettings
import expo.modules.notchisland.core.PillBox
import expo.modules.notchisland.core.CALL_GREEN
import expo.modules.notchisland.core.PillGeometry
import expo.modules.notchisland.core.Spring
import expo.modules.notchisland.core.callElapsed
import expo.modules.notchisland.core.durationText
import java.util.Calendar

// An accessibility overlay, unlike TYPE_APPLICATION_OVERLAY, sits above the status bar, so HyperOS lets the pill take touches there. The service reads no events and no screen content.
class NotchAccessibilityService : AccessibilityService() {
  private val main = Handler(Looper.getMainLooper())
  private var wm: WindowManager? = null
  private var pill: FrameLayout? = null
  private var card: IslandCard? = null
  private var params: WindowManager.LayoutParams? = null
  private var animator: ValueAnimator? = null
  private var open = false
  private var settings = NotchSettings.DEFAULTS
  private var hole: Cutout? = null
  private var small = PillBox(0, 0, 0)
  private var dot: View? = null
  private var callTime: TextView? = null
  private var shown: String? = null
  private var events: BroadcastReceiver? = null
  private val collapse = Runnable { setOpen(false) }
  private val tick = object : Runnable {
    override fun run() {
      val now = SystemClock.elapsedRealtime()
      val t = NotchTimer.state
      if (t.running && t.done(now)) NotchTimer.state = t.pause(now)
      if (open) card?.tickRows()
      if (stale()) {
        if (!animating()) reapply()
        return
      }
      updateIndicator()
      if (ticking()) main.postDelayed(this, 1000)
    }
  }

  override fun onServiceConnected() {
    running = true
    instance = this
    show()
    registerEvents()
    NotchMedia.onChange = this::setActive
    NotchTimer.onChange = this::setActive
  }

  override fun onUnbind(intent: Intent?): Boolean {
    running = false
    instance = null
    NotchMedia.onChange = null
    NotchTimer.onChange = null
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

  // The phase 1 indicator hook: media, a call or the timer changed. An open card rebinds its rows; a folded pill whose indicator changed is rebuilt at the new width.
  fun setActive() {
    if (pill == null) return
    if (open) {
      card?.bindRows(settings)
      resizeOpen()
    } else if (stale()) {
      if (!animating()) reapply()
      return
    }
    updateIndicator()
    main.removeCallbacks(tick)
    if (ticking()) main.post(tick)
  }

  // Rows appeared or went while the card is open: match the window height; the fold timer is left as it is.
  private fun resizeOpen() {
    val view = pill ?: return
    val lp = params ?: return
    if (animating()) return
    val box = expanded()
    if (lp.height == box.height) return
    lp.height = box.height
    corners(box)
    runCatching { wm?.updateViewLayout(view, lp) }
  }

  // A call wins over music and the timer.
  private fun indicator(): String? = when {
    NotchMedia.call != null -> CALL
    ("media" in settings.widgets && NotchMedia.media?.playing == true) || ("timer" in settings.widgets && NotchTimer.state.running) -> DOT
    else -> null
  }

  // A folded pill whose indicator changed is rebuilt at the new width, but never mid-morph; the morph's end catches up.
  private fun stale() = !open && indicator() != shown

  private fun animating() = animator?.isRunning == true

  // A running timer whose widget is off stays running unseen; its row shows the true time when the widget is back.
  private fun ticking() = ("timer" in settings.widgets && NotchTimer.state.running) || NotchMedia.call != null

  // A tap on the open card, or a rebuild while open, starts the fold-back delay again.
  private fun holdOpen() {
    if (!open) return
    main.removeCallbacks(collapse)
    PillGeometry.foldDelayMs(settings.foldMs)?.let { main.postDelayed(collapse, it) }
  }

  private fun folded(): PillBox {
    val density = resources.displayMetrics.density
    return when (shown) {
      CALL -> PillGeometry.withIndicator(small, (56 * density).toInt())
      DOT -> PillGeometry.withIndicator(small, (24 * density).toInt())
      else -> small
    }
  }

  private fun expanded(): PillBox {
    val density = resources.displayMetrics.density
    val screenW = resources.displayMetrics.widthPixels
    return PillGeometry.expanded(hole, screenW, density, card?.activeKinds(settings) ?: emptyList())
  }

  // Green dot and call time either side of the hole for a call; one dot for music or the timer.
  private fun updateIndicator() {
    val kind = indicator()
    shown = kind
    val d = dot ?: return
    val t = callTime ?: return
    d.visibility = if (kind == null) View.GONE else View.VISIBLE
    (d.background as GradientDrawable).setColor(if (kind == CALL) CALL_GREEN else Colours.accent(settings.accent))
    (d.layoutParams as FrameLayout.LayoutParams).gravity = Gravity.CENTER_VERTICAL or (if (kind == CALL) Gravity.START else Gravity.END)
    d.requestLayout()
    t.visibility = if (kind == CALL) View.VISIBLE else View.GONE
    NotchMedia.call?.let { t.text = durationText(callElapsed(Notification.CATEGORY_CALL, it.startedAt, System.currentTimeMillis()) ?: 0L) }
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
    val hole = cutout(manager)
    this.hole = hole
    small = PillGeometry.collapsed(hole, screenW, density, PillGeometry.sizeScale(settings.size))

    val holeWidth = hole?.let { it.right - it.left } ?: (58 * density).toInt()
    val content = IslandCard(this, holeWidth, small.height, density).apply {
      alpha = if (open) 1f else 0f
      scaleX = Spring.contentScale(alpha)
      scaleY = scaleX
      pivotY = 0f
      onTouchDown = this@NotchAccessibilityService::holdOpen
    }
    card = content
    refresh()
    val edge = (10 * density).toInt()
    val indicatorDot = View(this).apply {
      background = GradientDrawable().apply { shape = GradientDrawable.OVAL }
      layoutParams = FrameLayout.LayoutParams((6 * density).toInt(), (6 * density).toInt()).apply { leftMargin = edge; rightMargin = edge }
    }
    val indicatorTime = TextView(this).apply {
      textSize = 10f
      setTextColor(CALL_GREEN)
      setTypeface(typeface, android.graphics.Typeface.BOLD)
      fontFeatureSettings = "tnum"
      layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER_VERTICAL or Gravity.END)
        .apply { rightMargin = (6 * density).toInt() }
    }
    dot = indicatorDot
    callTime = indicatorTime
    updateIndicator()

    val view = FrameLayout(this).apply {
      background = GradientDrawable().apply { setColor(Colours.pill(settings.pill, settings.accent)) }
      contentDescription = "Notch"
      setOnClickListener { setOpen(!open) }
      addView(content, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
      addView(indicatorDot)
      addView(indicatorTime)
    }
    for (v in listOf(indicatorDot, indicatorTime)) v.alpha = if (open) 0f else 1f
    val box = if (open) expanded() else folded()
    content.pivotX = box.width / 2f
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
    holdOpen()
    main.removeCallbacks(tick)
    if (ticking()) main.post(tick)
  }

  private fun remove() {
    main.removeCallbacks(collapse)
    main.removeCallbacks(tick)
    animator?.cancel()
    pill?.let { v -> runCatching { wm?.removeView(v) } }
    pill = null
    card = null
    dot = null
    callTime = null
  }

  private fun corners(box: PillBox) {
    (pill?.background as? GradientDrawable)?.cornerRadius = PillGeometry.radius(settings.corners, box.height, resources.displayMetrics.density)
  }

  private fun refresh() {
    val intent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
    val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
    val percent = if (level >= 0 && scale > 0) level * 100 / scale else null
    val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
    card?.bind(settings, Calendar.getInstance(), percent, charging)
  }

  private fun setOpen(next: Boolean, holdMs: Long? = PillGeometry.foldDelayMs(settings.foldMs)) {
    val view = pill ?: return
    val lp = params ?: return
    main.removeCallbacks(collapse)
    if (next && holdMs != null) main.postDelayed(collapse, holdMs)
    if (next == open) return
    open = next
    if (next) {
      refresh()
    } else {
      updateIndicator()
    }
    animator?.cancel()
    val from = PillBox(lp.x, lp.width, lp.height)
    val to = if (next) expanded() else folded()
    val c = card
    val marks = listOfNotNull(dot, callTime)
    val screenW = resources.displayMetrics.widthPixels
    animator = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = Spring.SETTLE_MS
      interpolator = LinearInterpolator()
      addUpdateListener {
        val s = Spring.value((it.animatedFraction * Spring.SETTLE_MS).toLong())
        val box = PillGeometry.lerp(from, to, s, screenW)
        lp.x = box.xFromCenter
        lp.width = box.width
        lp.height = box.height
        corners(box)
        val p = s.coerceIn(0f, 1f)
        c?.apply {
          alpha = if (next) Spring.openAlpha(p) else Spring.closeAlpha(p)
          scaleX = Spring.contentScale(alpha)
          scaleY = scaleX
          pivotX = box.width / 2f
        }
        for (m in marks) m.alpha = if (next) 1f - p else p
        runCatching { wm?.updateViewLayout(view, lp) }
      }
      // Rows or the indicator that changed during the morph were left alone; catch up once it has ended.
      addListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(animation: Animator) {
          main.post {
            if (pill == null || animating()) return@post
            when {
              open -> resizeOpen()
              stale() -> reapply()
              ticking() -> { main.removeCallbacks(tick); main.post(tick) }
            }
          }
        }
      })
      start()
    }
  }

  private fun registerEvents() {
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
          Intent.ACTION_POWER_CONNECTED -> setOpen(true, CHARGE_OPEN_MS)
          Intent.ACTION_TIME_TICK -> if (open) refresh()
          Intent.ACTION_BATTERY_CHANGED -> if (open) refresh()
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
    private const val CALL = "call"
    private const val DOT = "dot"

    @Volatile var running = false
      private set

    @Volatile var instance: NotchAccessibilityService? = null
      private set
  }
}
