package expo.modules.haloengine.android

import android.content.Context
import android.graphics.PixelFormat
import android.hardware.input.InputManager
import android.provider.Settings
import android.view.WindowManager
import expo.modules.haloengine.core.Pattern
import expo.modules.haloengine.core.Settings as HaloSettings

/** One full-screen, touch-through overlay window hosting the [EdgeView]. */
class EdgeOverlay(
  private val ctx: Context,
  private val source: EdgeView.Source,
) {
  private val wm = ctx.getSystemService(WindowManager::class.java)
  private var view: EdgeView? = null

  fun add() {
    ProbeLog.log(ctx, "overlay", "canDrawOverlays=${Settings.canDrawOverlays(ctx)}")
    try {
      val maxOpacity = ctx.getSystemService(InputManager::class.java).maximumObscuringOpacityForTouch
      val v = EdgeView(ctx, source)
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
      ProbeLog.log(ctx, "overlay", "window added screen=${max.width()}x${max.height()}")
    } catch (e: Exception) {
      ProbeLog.log(ctx, "overlay", "window add FAILED ${e.javaClass.name}: ${e.message}")
    }
  }

  fun apply(s: HaloSettings, pattern: Pattern, colors: IntArray) {
    view?.apply(s, pattern, colors)
  }

  fun setColors(colors: IntArray) {
    view?.setColors(colors)
  }

  fun kick() {
    view?.kick()
  }

  fun remove() {
    view?.let { v ->
      v.stop()
      runCatching { wm.removeView(v) }.onFailure { ProbeLog.log(ctx, "overlay", "remove FAILED ${it.javaClass.name}: ${it.message}") }
    }
    view = null
    ProbeLog.log(ctx, "overlay", "window removed")
  }
}
