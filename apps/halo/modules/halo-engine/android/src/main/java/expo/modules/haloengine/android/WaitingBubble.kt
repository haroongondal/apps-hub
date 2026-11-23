package expo.modules.haloengine.android

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.TextView
import expo.modules.haloengine.applink.AppLinkTarget
import kotlin.math.abs

// A small touchable window of its own: the edge window stays non-touchable. It shows a count only, never a title, because it can sit over the lock screen.
class WaitingBubble(private val ctx: Context, colour: Int) {
  private val wm = ctx.getSystemService(WindowManager::class.java)
  private val dp = ctx.resources.displayMetrics.density
  private val size = (48 * dp).toInt()
  private var target: String? = null
  private var added = false
  private val lp = WindowManager.LayoutParams(
    size, size,
    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
    PixelFormat.TRANSLUCENT,
  ).apply {
    gravity = Gravity.TOP or Gravity.START
    x = ctx.resources.displayMetrics.widthPixels - size - (8 * dp).toInt()
    y = ctx.resources.displayMetrics.heightPixels / 3
  }
  private val view = TextView(ctx).apply {
    gravity = Gravity.CENTER
    textSize = 16f
    setTextColor(Color.BLACK)
    typeface = Fonts.get(ctx)[0]
    background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(colour) }
    setOnTouchListener(Drag())
    setOnClickListener { open() }
  }

  fun show(count: Int, pkg: String) {
    target = pkg
    view.text = if (count > 9) "9+" else count.toString()
    view.contentDescription = if (count == 1) "1 thing waiting. Tap to open." else "$count things waiting. Tap to open."
    if (added || !Settings.canDrawOverlays(ctx)) return
    added = runCatching { wm.addView(view, lp) }.onFailure { ProbeLog.log(ctx, "links", "bubble add FAILED ${it.javaClass.name}") }.isSuccess
  }

  fun remove() {
    if (added) runCatching { wm.removeView(view) }
    added = false
  }

  private fun open() {
    val pkg = target ?: return
    val i = ctx.packageManager.getLaunchIntentForPackage(pkg) ?: return
    // The launcher is not a link action, so it does not require the link permission; package and signature are still checked.
    if (!AppLinkTarget.trustedActivity(ctx, i, requireLinkPermission = false)) return
    runCatching { ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
      .onFailure { ProbeLog.log(ctx, "links", "bubble open FAILED ${it.javaClass.name}") }
  }

  private inner class Drag : android.view.View.OnTouchListener {
    private val slop = ViewConfiguration.get(ctx).scaledTouchSlop
    private var downX = 0f
    private var downY = 0f
    private var startX = 0
    private var startY = 0
    private var moved = false

    override fun onTouch(v: android.view.View, e: MotionEvent): Boolean {
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = e.rawX; downY = e.rawY; startX = lp.x; startY = lp.y; moved = false
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = e.rawX - downX
          val dy = e.rawY - downY
          if (abs(dx) > slop || abs(dy) > slop) moved = true
          if (moved && added) {
            lp.x = startX + dx.toInt()
            lp.y = startY + dy.toInt()
            runCatching { wm.updateViewLayout(view, lp) }
          }
        }
        MotionEvent.ACTION_UP -> if (!moved) v.performClick()
      }
      return true
    }
  }
}
