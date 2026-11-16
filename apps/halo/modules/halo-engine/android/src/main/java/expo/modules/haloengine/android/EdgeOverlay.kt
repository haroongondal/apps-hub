package expo.modules.haloengine.android

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.hardware.display.DisplayManager
import android.hardware.input.InputManager
import android.provider.Settings
import android.view.Display
import android.view.RoundedCorner
import android.view.View
import android.view.WindowManager

/** Spike: one full-screen overlay window drawing a 3 dp ring whose alpha follows the FFT level. */
class EdgeOverlay(private val ctx: Context) {
  private val wm = ctx.getSystemService(WindowManager::class.java)
  private var view: RingView? = null

  private fun radii(): FloatArray {
    val d = ctx.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
    fun r(pos: Int) = (d?.getRoundedCorner(pos)?.radius ?: 0).toFloat()
    return floatArrayOf(r(RoundedCorner.POSITION_TOP_LEFT), r(RoundedCorner.POSITION_TOP_RIGHT), r(RoundedCorner.POSITION_BOTTOM_RIGHT), r(RoundedCorner.POSITION_BOTTOM_LEFT))
  }

  fun add() {
    ProbeLog.log(ctx, "overlay", "canDrawOverlays=${Settings.canDrawOverlays(ctx)}")
    try {
      val corners = radii()
      val maxOpacity = ctx.getSystemService(InputManager::class.java).maximumObscuringOpacityForTouch
      val v = RingView(ctx, corners)
      val lp = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT,
      ).apply {
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
        // Cover the whole display, including under the status and navigation bars.
        fitInsetsTypes = 0
        fitInsetsSides = 0
        // Android 12+ drops touches that pass through another app's overlay above this opacity, so a full-screen overlay at alpha 1.0 blocks every tap.
        alpha = minOf(0.8f, maxOpacity)
      }
      ProbeLog.log(ctx, "overlay", "window alpha=${lp.alpha} maxObscuringOpacityForTouch=$maxOpacity")
      wm.addView(v, lp)
      view = v
      val max = wm.maximumWindowMetrics.bounds
      ProbeLog.log(ctx, "overlay", "window added corners(tl,tr,br,bl)=${corners.joinToString(",") { it.toInt().toString() }} screen=${max.width()}x${max.height()}")
    } catch (e: Exception) {
      ProbeLog.log(ctx, "overlay", "window add FAILED ${e.javaClass.name}: ${e.message}")
    }
  }

  fun setLevel(level: Float) {
    view?.setLevel(level)
  }

  fun remove() {
    view?.let { v -> runCatching { wm.removeView(v) }.onFailure { ProbeLog.log(ctx, "overlay", "remove FAILED ${it.javaClass.name}: ${it.message}") } }
    view = null
    ProbeLog.log(ctx, "overlay", "window removed")
  }

  private class RingView(private val c: Context, private val radii: FloatArray) : View(c) {
    private val dp = resources.displayMetrics.density
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = 3 * dp
      color = 0xFF4DD0E1.toInt()
    }
    private val path = Path()
    private var alpha255 = 40

    fun setLevel(level: Float) {
      val a = 40 + (215 * level).toInt()
      if (a != alpha255) {
        alpha255 = a
        invalidate()
      }
    }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
      val half = paint.strokeWidth / 2
      path.reset()
      // addRoundRect wants x and y radii per corner (8 values), in the order tl, tr, br, bl.
      path.addRoundRect(RectF(half, half, w - half, h - half), FloatArray(8) { radii[it / 2] }, Path.Direction.CW)
      ProbeLog.log(c, "overlay", "view size=${w}x$h")
    }

    override fun onDraw(canvas: Canvas) {
      paint.alpha = alpha255
      canvas.drawPath(path, paint)
    }
  }
}
