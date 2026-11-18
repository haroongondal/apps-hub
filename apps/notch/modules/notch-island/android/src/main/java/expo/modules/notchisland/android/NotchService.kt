package expo.modules.notchisland.android

import android.animation.ValueAnimator
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextClock
import expo.modules.notchisland.core.Cutout
import expo.modules.notchisland.core.PillBox
import expo.modules.notchisland.core.PillGeometry

class NotchService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private var wm: WindowManager? = null
  private var pill: FrameLayout? = null
  private var params: WindowManager.LayoutParams? = null
  private var animator: ValueAnimator? = null
  private var open = false
  private val collapse = Runnable { setOpen(false) }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    running = true
    startForeground()
    if (!Settings.canDrawOverlays(this)) return stopSelf()
    show()
  }

  override fun onDestroy() {
    running = false
    main.removeCallbacks(collapse)
    animator?.cancel()
    pill?.let { v -> runCatching { wm?.removeView(v) } }
    super.onDestroy()
  }

  private fun startForeground() {
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CHANNEL, "Notch", NotificationManager.IMPORTANCE_MIN))
    val n = Notification.Builder(this, CHANNEL).setSmallIcon(applicationInfo.icon).setContentTitle("Notch is on").build()
    if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(1, n)
  }

  private fun cutout(manager: WindowManager): Cutout? {
    if (Build.VERSION.SDK_INT < 30) return null
    val c = manager.currentWindowMetrics.windowInsets.displayCutout ?: return null
    val r = c.boundingRectTop
    return if (r.isEmpty) null else Cutout(r.left, r.right, r.bottom)
  }

  private fun show() {
    val manager = getSystemService(WindowManager::class.java)
    val density = resources.displayMetrics.density
    val screenW = resources.displayMetrics.widthPixels
    val hole = cutout(manager)
    val small = PillGeometry.collapsed(hole, screenW, density)
    val big = PillGeometry.expanded(hole, screenW, density)
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
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      x = small.xFromCenter
      if (Build.VERSION.SDK_INT >= 28) layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }
    if (runCatching { manager.addView(view, lp) }.isFailure) return stopSelf()
    wm = manager
    pill = view
    params = lp
    this.small = small
    this.big = big
    corners(view, small)
  }

  private var small = PillBox(0, 0, 0)
  private var big = PillBox(0, 0, 0)

  private fun corners(view: View, box: PillBox) {
    (view.background as GradientDrawable).cornerRadius = minOf(box.height / 2f, 28 * resources.displayMetrics.density)
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
        corners(view, box)
        view.getChildAt(0).alpha = if (next) t else 1f - t
        runCatching { wm?.updateViewLayout(view, lp) }
      }
      start()
    }
  }

  companion object {
    private const val CHANNEL = "notch"
    private const val AUTO_COLLAPSE_MS = 4000L

    @Volatile var running = false
      private set

    fun start(c: Context) = c.startForegroundService(Intent(c, NotchService::class.java))

    fun stop(c: Context) = c.stopService(Intent(c, NotchService::class.java))
  }
}
