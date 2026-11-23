package expo.modules.notchisland.android

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.os.SystemClock
import android.view.View
import expo.modules.notchisland.core.ProgressRing

class RingView(context: Context, density: Float) : View(context) {
  private val stroke = 2.5f * density
  private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = stroke; color = SOFT }
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = stroke; strokeCap = Paint.Cap.ROUND }
  private var degrees = -1
  private var spinning = false

  fun bind(fraction: Float?, accent: Int) {
    val nextDegrees = fraction?.let { (it.coerceIn(0f, 1f) * 360).toInt() } ?: -1
    val nextSpin = fraction == null
    if (nextDegrees == degrees && nextSpin == spinning && fill.color == accent) return
    degrees = nextDegrees
    spinning = nextSpin
    fill.color = accent
    invalidate()
  }

  // An open card hides the ring at alpha 0, which stops the spin; it restarts when the ring shows again.
  override fun setAlpha(alpha: Float) {
    val wasHidden = this.alpha <= 0f
    super.setAlpha(alpha)
    if (wasHidden && alpha > 0f && spinning) invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    val inset = stroke / 2
    val l = inset
    val t = inset
    val r = width - inset
    val b = height - inset
    canvas.drawOval(l, t, r, b, track)
    if (spinning) {
      val start = (SystemClock.uptimeMillis() % SPIN_MS) * 360f / SPIN_MS
      canvas.drawArc(l, t, r, b, start - 90f, 90f, false, fill)
      if (alpha > 0f) postInvalidateDelayed(ProgressRing.SPIN_FRAME_MS)
    } else if (degrees > 0) {
      canvas.drawArc(l, t, r, b, -90f, degrees.toFloat(), false, fill)
    }
  }

  private companion object {
    const val SPIN_MS = 1_200L
  }
}
