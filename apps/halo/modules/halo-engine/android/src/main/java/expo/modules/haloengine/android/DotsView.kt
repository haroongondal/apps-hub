package expo.modules.haloengine.android

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.TypedValue
import android.view.View
import android.view.WindowInsets
import android.view.animation.DecelerateInterpolator
import expo.modules.haloengine.core.DotCell
import expo.modules.haloengine.core.DotKind
import expo.modules.haloengine.core.DotLayout
import expo.modules.haloengine.core.DotMetrics
import expo.modules.haloengine.core.DotRow
import expo.modules.haloengine.core.DotShape

/** The always-on status dots, top right. Draws only when the row changes; a ripple is the one short animation. */
class DotsView(ctx: Context) : View(ctx) {
  private class Ripple(val colour: Int, val cx: Float, val cy: Float) {
    var f = 0f
    var anim: ValueAnimator? = null
  }

  private val dp = resources.displayMetrics.density
  private val m = DotMetrics(dot = 12 * dp, gap = 10 * dp, labelGap = 3 * dp, lineGap = 8 * dp)
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2 * dp }
  private val flap = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 1.2f * dp; color = Color.BLACK }
  private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    textSize = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 11f, resources.displayMetrics)
    typeface = Fonts.get(ctx)[2]
  }
  private val path = Path()
  private val rect = RectF()
  private var row: DotRow? = null
  private var counts = true
  private var cells: List<DotCell> = emptyList()
  private val ripples = ArrayList<Ripple>()

  fun set(row: DotRow, counts: Boolean) {
    if (row == this.row && counts == this.counts) return
    val fresh = DotLayout.fresh(this.row, row)
    this.row = row
    this.counts = counts
    relayout()
    contentDescription = describe(row)
    if (isShown) for (c in cells) c.dot?.takeIf { it.kind in fresh }?.let { ripple(it.kind.colour, c) }
    invalidate()
  }

  override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) = relayout()

  override fun onDetachedFromWindow() {
    ripples.toList().forEach { it.anim?.cancel() }
    super.onDetachedFromWindow()
  }

  private fun relayout() {
    val r = row ?: return
    // The status bar is hidden on the always-on screen, so its height comes from the insets ignoring visibility.
    val ins = rootWindowInsets
    val cut = ins?.getInsets(WindowInsets.Type.displayCutout())
    val bar = ins?.getInsetsIgnoringVisibility(WindowInsets.Type.statusBars())
    val top = maxOf(cut?.top ?: 0, bar?.top ?: 0) + 16 * dp
    val right = width - (cut?.right ?: 0) - 16 * dp
    cells = DotLayout.place(r, counts, right, top, m) { text.measureText(it) }
  }

  override fun onDraw(canvas: Canvas) {
    val baseline = m.dot / 2 - (text.ascent() + text.descent()) / 2
    for (c in cells) {
      val d = c.dot
      if (d == null) {
        text.color = Color.WHITE
        canvas.drawText(c.label ?: continue, c.x, c.y + baseline, text)
        continue
      }
      shape(canvas, d.kind, c.x + m.dot / 2, c.y + m.dot / 2)
      c.label?.let {
        text.color = d.kind.colour
        canvas.drawText(it, c.x + m.dot + m.labelGap, c.y + baseline, text)
      }
    }
    for (r in ripples) {
      ring.color = r.colour
      ring.alpha = ((1f - r.f) * 255).toInt()
      canvas.drawCircle(r.cx, r.cy, m.dot / 2 + (RIPPLE_DP * dp - m.dot / 2) * r.f, ring)
    }
    ring.alpha = 255
  }

  private fun shape(c: Canvas, k: DotKind, x: Float, y: Float) {
    val r = m.dot / 2
    val h = ring.strokeWidth / 2
    fill.color = k.colour
    ring.color = k.colour
    path.reset()
    when (k.shape) {
      DotShape.CIRCLE -> c.drawCircle(x, y, r, fill)
      DotShape.RING -> c.drawCircle(x, y, r - h, ring)
      DotShape.SQUARE_RING -> {
        rect.set(x - r + h, y - r + h, x + r - h, y + r - h)
        c.drawRoundRect(rect, r * 0.5f, r * 0.5f, ring)
      }
      DotShape.ROUNDED_SQUARE -> {
        rect.set(x - r, y - r, x + r, y + r)
        c.drawRoundRect(rect, r * 0.4f, r * 0.4f, fill)
      }
      DotShape.BAR -> {
        rect.set(x - r * 0.4f, y - r, x + r * 0.4f, y + r)
        c.drawRoundRect(rect, r * 0.2f, r * 0.2f, fill)
      }
      DotShape.ENVELOPE -> {
        rect.set(x - r, y - r * 0.7f, x + r, y + r * 0.7f)
        c.drawRoundRect(rect, r * 0.15f, r * 0.15f, fill)
        path.moveTo(x - r, y - r * 0.7f)
        path.lineTo(x, y + r * 0.1f)
        path.lineTo(x + r, y - r * 0.7f)
        c.drawPath(path, flap)
      }
      DotShape.BUBBLE -> {
        c.drawCircle(x + r * 0.1f, y - r * 0.1f, r * 0.85f, fill)
        poly(c, x, y, r, -0.55f, 0.35f, -1f, 1f, -0.05f, 0.7f)
      }
      DotShape.DIAMOND -> poly(c, x, y, r, 0f, -1f, 1f, 0f, 0f, 1f, -1f, 0f)
      DotShape.TRIANGLE -> poly(c, x, y, r, -0.7f, -1f, 1f, 0f, -0.7f, 1f)
      DotShape.BOLT -> poly(c, x, y, r, 0.25f, -1f, -0.6f, 0.15f, -0.05f, 0.15f, -0.25f, 1f, 0.6f, -0.15f, 0.05f, -0.15f)
    }
  }

  private fun poly(c: Canvas, x: Float, y: Float, r: Float, vararg p: Float) {
    path.reset()
    path.moveTo(x + p[0] * r, y + p[1] * r)
    for (i in 2 until p.size step 2) path.lineTo(x + p[i] * r, y + p[i + 1] * r)
    path.close()
    c.drawPath(path, fill)
  }

  private fun ripple(colour: Int, c: DotCell) {
    val r = Ripple(colour, c.x + m.dot / 2, c.y + m.dot / 2)
    ripples.add(r)
    r.anim = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = RIPPLE_MS
      interpolator = DecelerateInterpolator()
      addUpdateListener { r.f = it.animatedValue as Float; invalidate() }
      addListener(object : AnimatorListenerAdapter() {
        override fun onAnimationEnd(a: Animator) {
          ripples.remove(r)
          invalidate()
        }
      })
      start()
    }
  }

  private fun describe(row: DotRow): String = (
    row.dots.map { d -> name(d.kind) + if (d.count > 1) ", ${d.count}" else "" } + listOfNotNull(if (row.overflow > 0) "${row.overflow} more" else null)
  ).joinToString("; ")

  private fun name(k: DotKind) = when (k) {
    DotKind.CHARGING -> "Charging"
    DotKind.LOW_BATTERY -> "Low battery"
    DotKind.CALL -> "Calls"
    DotKind.WHATSAPP -> "WhatsApp"
    DotKind.INSTAGRAM -> "Instagram"
    DotKind.MESSAGE -> "Messages"
    DotKind.EMAIL -> "Email"
    DotKind.OTHER -> "Other apps"
    DotKind.ALARM -> "Alarm within the hour"
    DotKind.MEDIA -> "Music playing"
  }

  private companion object {
    const val RIPPLE_MS = 1_000L
    const val RIPPLE_DP = 28f
  }
}
